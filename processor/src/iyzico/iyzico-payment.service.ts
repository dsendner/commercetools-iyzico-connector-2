import { BadRequestException, Inject, Injectable, InternalServerErrorException, Logger, NotFoundException, UnauthorizedException, UseGuards } from '@nestjs/common';
import * as connectPaymentsSdk from '@commercetools/connect-payments-sdk';
import { IyzicoInitializeResponse, toIyzicoInitializeRequest } from './converters/iyzico-create-session.converter';
import { IyzicoClient } from './iyzico.client';
import { buildCallbackUrl } from './helper.converter';
import { IyzicoPaymentResult, IyzicoRetrieveResponse, toIyzicoPaymentResult } from './converters/iyzico-retrieve-payment.converter';
import { IyzicoWebhookPayload } from './converters/webhook.converter';
import { IyzicoCardService } from './iyzico-card.service';
import { CT_CART_SERVICE, CT_PAYMENT_SERVICE } from '../commercetools/tokens';
import { AppConfigService } from '../config/config.service';
import { getRequestContext } from '../commercetools/context/request-context';
import { isSameIyzicoDay, IyzicoRefundResponse, toIyzicoCancelRequest, toIyzicoRefundRequest } from './converters/iyzico-refund.converter';

export interface CreateSessionRequest {
    cartId: string;
    clientIp: string;
    cart: connectPaymentsSdk.Cart;
}

export interface CreateSessionResponse {
    paymentReference: string;
    checkoutFormContent: string;
    paymentPageUrl: string;
}

type FlowEndpoints = { init: string; retrieve: string; retrieveTokenField: 'token' | 'checkoutFormToken', enabledInstallments?: number[] };

const STANDARD: FlowEndpoints = {
    init: '/payment/iyzipos/checkoutform/initialize/auth/ecom',
    retrieve: '/payment/iyzipos/checkoutform/auth/ecom/detail',
    retrieveTokenField: 'token',
};

const SUBSCRIPTION: FlowEndpoints = {
    init: '/v1/pay-with-iyzico/third-party-session/checkout/init',
    retrieve: '/v1/pay-with-iyzico/third-party-session/retrieve/payment',
    retrieveTokenField: 'checkoutFormToken',
    enabledInstallments: [1],
};

const LOCALE = 'tr';

const REFUND_V2 = '/v2/payment/refund';
const CANCEL = '/payment/cancel';

type ReversalOperation = 'cancel' | 'refund';

const TRANSACTION_BY_OUTCOME: Record<IyzicoPaymentResult['outcome'], { type: string; state: string }> = {
    Success: { type: 'Charge', state: 'Success' },
    Failure: { type: 'Charge', state: 'Failure' },
    Pending: { type: 'Charge', state: 'Pending' },
};

const SWITCH_CARD_SUBSCRIPTION_KEY_FIELD = 'subscription_key';

const IYZICO_NO_PAYMENT_FOR_TOKEN = '5122';

function toMoney(m: connectPaymentsSdk.Money): connectPaymentsSdk.Money {
    return { centAmount: m.centAmount, currencyCode: m.currencyCode };
}

function isFinalState(state: string | undefined): state is 'Success' | 'Failure' {
    return state === 'Success' || state === 'Failure';
}

function finalChargeState(payment: connectPaymentsSdk.Payment): 'Success' | 'Failure' | undefined {
    const state = (payment.transactions ?? []).find(t => t.type === 'Charge')?.state;
    return isFinalState(state) ? state : undefined;
}


@Injectable()
export class IyzicoPaymentService {
    private readonly logger = new Logger(IyzicoPaymentService.name);

    constructor(
        @Inject(CT_CART_SERVICE) private readonly ctCart: connectPaymentsSdk.CommercetoolsCartService,
        @Inject(CT_PAYMENT_SERVICE) private readonly ctPayment: connectPaymentsSdk.CommercetoolsPaymentService,
        private readonly iyzico: IyzicoClient,
        private readonly iyzicoCardService: IyzicoCardService,
        private readonly config: AppConfigService,
    ) { }

    async createSession(req: CreateSessionRequest): Promise<CreateSessionResponse> {
        const cart = req.cart;
        const flow = this.flowFor(cart);

        const payment = await this.ctPayment.createPayment({
            amountPlanned: toMoney(cart.totalPrice),
            paymentMethodInfo: { paymentInterface: 'iyzico' },
        });

        const initResponse = await this.initCheckoutForm(cart, payment, req.clientIp, flow);

        await this.persistInitialization(cart, payment, initResponse);
        await this.ctCart.addPayment({ resource: cart, paymentId: payment.id });

        this.logger.log(`INIT RESPONSE: checkoutFormContent=${!!initResponse.checkoutFormContent}, paymentPageUrl=${initResponse.paymentPageUrl}`);

        return {
            paymentReference: payment.id,
            checkoutFormContent: initResponse.checkoutFormContent,
            paymentPageUrl: initResponse.paymentPageUrl,
        };
    }

    async handleCallback(req: { token: string; returnUrl?: string }): Promise<string> {
        const payment = await this.findPaymentByToken(req.token);
        const result = await this.finalizePayment(payment, req.token);

        return this.buildReturnUrl(payment, req.returnUrl);
    }

    async handleWebhook(payload: IyzicoWebhookPayload, signature: string): Promise<void> {
        if (!this.iyzico.verifyWebhookSignature(payload, signature)) {
            throw new UnauthorizedException('Invalid webhook signature');
        }

        const payment = await this.findPaymentByToken(payload.token).catch(() => undefined);
        if (!payment) {
            this.logger.warn(`Webhook for unknown token ${payload.token} — ignored`);
            return;
        }

        await this.finalizePayment(payment, payload.token);
    }

    private async initCheckoutForm(
        cart: connectPaymentsSdk.Cart,
        payment: connectPaymentsSdk.Payment,
        clientIp: string,
        flow: FlowEndpoints,
    ): Promise<IyzicoInitializeResponse> {
        const callbackUrl = this.callbackUrlFor(payment.id);
        const cardUserKey = cart.customerId
            ? await this.iyzicoCardService.getUserKey(cart.customerId)
            : undefined;

        const request = toIyzicoInitializeRequest(
            cart, payment, callbackUrl, clientIp, cardUserKey, this.conversationIdFor(payment), flow.enabledInstallments
        );

        const response = await this.iyzico.post<IyzicoInitializeResponse>(flow.init, request);

        if (response.status !== 'success' || !response.token) {
            this.logger.error(`Iyzico init failed on ${flow.init}: [${response.errorCode}] ${response.errorMessage}`);
            throw new InternalServerErrorException('Could not start the checkout init payment');
        }

        return response;
    }

    private async persistInitialization(
        cart: connectPaymentsSdk.Cart,
        payment: connectPaymentsSdk.Payment,
        init: IyzicoInitializeResponse,
    ): Promise<void> {
        await this.ctPayment.updatePayment({
            id: payment.id,
            pspReference: init.token,
            customFields: {
                type: { key: 'iyzico-payment', typeId: 'type' },
                fields: {
                    conversationId: this.conversationIdFor(payment),
                },
            },
            transaction: {
                type: 'Charge',
                state: 'Initial',
                amount: toMoney(cart.totalPrice),
                interactionId: init.token,
            },
            pspInteractions: [
                connectPaymentsSdk.GenerateInterfaceInteractionCustomFieldsDraft({
                    interactionId: init.token,
                    createdAt: new Date().toISOString(),
                    type: 'iyzico-checkout-form',
                    response: JSON.stringify({ paymentPageUrl: init.paymentPageUrl }),
                }),
            ],
        });
    }

    private async finalizePayment(
        payment: connectPaymentsSdk.Payment,
        token: string,
    ): Promise<IyzicoPaymentResult> {
        const settled = finalChargeState(payment);
        if (settled) {
            return {
                outcome: settled,
                fraudDecision: 'approved',
                isFraud: false,
                iyzicoPaymentId: payment.id,
                errorMessage: settled === 'Failure' ? 'Payment could not be completed' : undefined,
            };
        }

        const cart = await this.ctCart.getCartByPaymentId({ paymentId: payment.id }).catch(() => undefined);
        if (!cart) {
            this.logger.warn(`Cart not found for payment ${payment.id}`);
            return {
                outcome: 'Failure',
                fraudDecision: 'approved',
                isFraud: false,
                iyzicoPaymentId: payment.id,
                errorMessage: 'Cart not found',
            };
        }
        const flow = this.flowFor(cart);
        const retrieve = await this.retrieveIyzicoPayment(payment, token, flow);

        if (retrieve.errorCode === IYZICO_NO_PAYMENT_FOR_TOKEN) {
            this.logger.warn(`No Iyzico payment yet for token ${token} on payment ${payment.id}, left unsettled`);
            return {
                outcome: 'Pending',
                fraudDecision: 'approved',
                isFraud: false,
                iyzicoPaymentId: payment.id,
                errorCode: retrieve.errorCode,
                errorMessage: retrieve.errorMessage,
            };
        }

        const result = toIyzicoPaymentResult(retrieve);

        const cardId = result.outcome === 'Success' ? await this.storeCard(payment, cart, result) : undefined;

        await this.recordPaymentOnCommercetools(payment, result, token, cardId);

        if (result.outcome === 'Success' && this.isSwitchCardCart(cart)) {
            await this.reverseSwitchCardPayment(payment, result);
        }

        return result;
    }

    private async storeCard(
        payment: connectPaymentsSdk.Payment,
        cart: connectPaymentsSdk.Cart,
        result: IyzicoPaymentResult,
    ): Promise<string | undefined> {
        if (!cart.customerId) {
            this.logger.warn(`Card storage skipped: guest cart on payment ${payment.id}`);
            return undefined;
        }

        if (!result.cardUserKey || !result.cardToken) {
            this.logger.warn(`No card token on payment ${payment.id} — nothing to store`);
            return undefined;
        }

        try {
            const saved = await this.iyzicoCardService.saveCard(cart.customerId, {
                cardUserKey: result.cardUserKey,
                cardToken: result.cardToken,
                brand: result.cardBrand,
                lastFourDigits: result.lastFourDigits,
                bin: result.binNumber,
            });

            this.logger.log(`Card stored as PaymentMethod ${saved.id} for customer ${cart.customerId}`);
            return saved.id;
        } catch (error) {
            this.logger.error(`Could not save card for payment ${payment.id}: ${error}`);
            return undefined;
        }
    }
    private async reverseSwitchCardPayment(
        payment: connectPaymentsSdk.Payment,
        result: IyzicoPaymentResult,
    ): Promise<void> {
        const amount = toMoney(payment.amountPlanned);

        if (!result.iyzicoPaymentId) {
            this.logger.error(`Switch card reversal skipped: no Iyzico paymentId on payment ${payment.id}, needs a manual refund`);
            await this.recordReversalOnCommercetools(payment, amount, 'refund', {
                status: 'failure',
                errorMessage: 'Missing Iyzico paymentId',
            });
            return;
        }

        const conversationId = result.conversationId ?? this.conversationIdFor(payment);

        if (isSameIyzicoDay(new Date(payment.createdAt), new Date())) {
            const cancel = await this.callReversal(
                payment,
                'cancel',
                CANCEL,
                toIyzicoCancelRequest(result.iyzicoPaymentId, conversationId, LOCALE),
            );

            if (cancel.status === 'success') {
                this.logger.log(`Switch card payment ${payment.id} cancelled on Iyzico payment ${result.iyzicoPaymentId}`);
                await this.recordReversalOnCommercetools(payment, amount, 'cancel', cancel);
                return;
            }

            this.logger.warn(
                `Iyzico refused to cancel the switch card payment ${payment.id}, falling back to a refund: [${cancel.errorCode}] ${cancel.errorMessage}`,
            );
        }

        const refund = await this.callReversal(
            payment,
            'refund',
            REFUND_V2,
            toIyzicoRefundRequest(result.iyzicoPaymentId, payment.amountPlanned, conversationId, LOCALE),
        );

        if (refund.status === 'success') {
            this.logger.log(`Switch card payment ${payment.id} refunded on Iyzico payment ${result.iyzicoPaymentId}`);
        } else {
            this.logger.error(
                `Iyzico refused the switch card refund for payment ${payment.id}, needs a manual refund: [${refund.errorCode}] ${refund.errorMessage}`,
            );
        }

        await this.recordReversalOnCommercetools(payment, amount, 'refund', refund);
    }

    private async callReversal(
        payment: connectPaymentsSdk.Payment,
        operation: ReversalOperation,
        path: string,
        request: object,
    ): Promise<IyzicoRefundResponse> {
        try {
            return await this.iyzico.post<IyzicoRefundResponse>(path, request);
        } catch (error) {
            this.logger.error(`Switch card ${operation} call failed for payment ${payment.id}: ${error}`);
            return { status: 'failure', errorMessage: String(error) };
        }
    }

    private async recordReversalOnCommercetools(
        payment: connectPaymentsSdk.Payment,
        amount: connectPaymentsSdk.Money,
        operation: ReversalOperation,
        response: IyzicoRefundResponse,
    ): Promise<void> {
        const state = response.status === 'success' ? 'Success' : 'Failure';
        const interactionId = response.cancelHostReference ?? response.refundHostReference ?? response.paymentId ?? payment.id;

        await this.ctPayment.updatePayment({
            id: payment.id,
            transaction: {
                type: 'Refund',
                state,
                amount,
                interactionId,
            },
            pspInteractions: [
                connectPaymentsSdk.GenerateInterfaceInteractionCustomFieldsDraft({
                    interactionId,
                    createdAt: new Date().toISOString(),
                    type: `iyzico-${operation}-${state.toLowerCase()}`,
                    response: JSON.stringify({
                        status: response.status,
                        paymentId: response.paymentId,
                        price: response.price,
                        currency: response.currency,
                        cancelHostReference: response.cancelHostReference,
                        refundHostReference: response.refundHostReference,
                        retryable: response.retryable,
                        errorCode: response.errorCode,
                        errorMessage: response.errorMessage,
                    }),
                }),
            ],
        }).catch((error) => {
            this.logger.error(`Could not record the switch card ${operation} on payment ${payment.id}: ${error}`);
        });
    }

    private async retrieveIyzicoPayment(
        payment: connectPaymentsSdk.Payment,
        token: string,
        flow: FlowEndpoints,
    ): Promise<IyzicoRetrieveResponse> {
        const conversationId = payment.custom?.fields?.conversationId as string
            ?? this.conversationIdFor(payment);
        const response = await this.iyzico.post<IyzicoRetrieveResponse>(flow.retrieve, {
            locale: LOCALE,
            conversationId: conversationId,
            [flow.retrieveTokenField]: token,
        });

        this.logger.log(`RAW RETRIEVE: ${JSON.stringify(response, null, 2)}`);
        return response;
    }

    private async recordPaymentOnCommercetools(
        payment: connectPaymentsSdk.Payment,
        result: IyzicoPaymentResult,
        token: string,
        cardId?: string,
    ): Promise<void> {
        const { type, state } = TRANSACTION_BY_OUTCOME[result.outcome];

        await this.ctPayment.updatePayment({
            id: payment.id,
            paymentMethod: result.cardBrand,
            transaction: {
                type,
                state,
                amount: toMoney(payment.amountPlanned),
                interactionId: token,
            },
            customFields: {
                type: { key: 'iyzico-payment', typeId: 'type' },
                fields: {
                    cardType: result.cardType,
                    cardAssociation: result.cardAssociation,
                    cardFamily: result.cardFamily,
                    binNumber: result.binNumber,
                    lastFourDigits: result.lastFourDigits,
                    installments: result.installment,
                    conversationId: result.conversationId,
                    ...(cardId ? { cardId } : {}),
                },
            },
            pspInteractions: [
                connectPaymentsSdk.GenerateInterfaceInteractionCustomFieldsDraft({
                    interactionId: token,
                    createdAt: new Date().toISOString(),
                    type: `iyzico-confirm-${result.outcome.toLowerCase()}`,
                    response: JSON.stringify({
                        outcome: result.outcome,
                        fraudDecision: result.fraudDecision,
                        rawPaymentStatus: result.rawPaymentStatus,
                        installment: result.installment,
                        errorCode: result.errorCode,
                        errorMessage: result.errorMessage,
                    }),
                }),
            ],
        });
    }

    private async findPaymentByToken(token: string): Promise<connectPaymentsSdk.Payment> {
        const [payment] = await this.ctPayment.findPaymentsByInterfaceId({ interfaceId: token });
        if (!payment) {
            throw new NotFoundException(`Payment with Iyzico token ${token} not found`);
        }
        return payment;
    }

    private isSubscriptionCart(cart: connectPaymentsSdk.Cart): boolean {
        const field = this.config.get('SUBSCRIPTION_DETECTION_FIELD');
        const withCode = cart.lineItems.filter(li => li.custom?.fields?.[field] != null);

        this.logger.log(`Cart ${cart.id}: ${withCode.length}/${cart.lineItems.length} lineItems with ${field}`);
        return withCode.length > 0;
    }

    private isSwitchCardCart(cart: connectPaymentsSdk.Cart): boolean {
        if (Number(cart.custom?.fields?.orderTimes) > 1) return false;

        return cart.lineItems.some(li => li.custom?.fields?.[SWITCH_CARD_SUBSCRIPTION_KEY_FIELD] != null);
    }

    private flowFor(cart: connectPaymentsSdk.Cart): FlowEndpoints {
        return this.isSubscriptionCart(cart) ? SUBSCRIPTION : STANDARD;
    }

    private conversationIdFor(payment: connectPaymentsSdk.Payment): string {
        const ctx = getRequestContext();
        return connectPaymentsSdk.getFutureOrderNumberFromContext(ctx) ?? payment.id;
    }

    private callbackUrlFor(id: string): string {
        const ctx = getRequestContext();

        const fromContext = connectPaymentsSdk.getProcessorUrlFromContext(ctx);
        const fromEnv = process.env.NODE_ENV !== 'production'
            ? process.env.PROCESSOR_PUBLIC_URL
            : undefined;

        const baseUrl = fromContext ?? fromEnv;

        if (!baseUrl) {
            throw new InternalServerErrorException('Could not determine processor URL');
        }

        const merchantReturnUrl = connectPaymentsSdk.getMerchantReturnUrlFromContext(ctx)
            ?? (process.env.NODE_ENV !== 'production' ? process.env.DEFAULT_RETURN_URL : undefined);

        return buildCallbackUrl(
            baseUrl,
            id,
            connectPaymentsSdk.getCtSessionIdFromContext(ctx),
            merchantReturnUrl,
        );
    }

    private buildReturnUrl(
        payment: connectPaymentsSdk.Payment,
        returnUrl?: string,
    ): string {
        if (!returnUrl) {
            this.logger.warn(`No returnUrl on callback for payment ${payment.id}`);
            throw new InternalServerErrorException('No return URL available');
        }

        const url = new URL(returnUrl);
        url.searchParams.set('paymentId', payment.id);

        const extraParams = this.config.get('RETURN_URL_EXTRA_QUERY');
        this.logger.log(`Raw config value: "${extraParams}"`); // affichera: "zone=toto&subscription=abc"
        this.logger.log(`Node native env: ${process.env.RETURN_URL_EXTRA_QUERY}`);

        if (extraParams) {
            const parsed = new URLSearchParams(extraParams);

            parsed.forEach((value, key) => {
                url.searchParams.set(key, value);
            });
        }

        return url.toString();
    }
}