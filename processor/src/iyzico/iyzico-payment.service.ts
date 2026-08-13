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

type FlowEndpoints = { init: string; retrieve: string; retrieveTokenField: 'token' | 'checkoutFormToken' };

const STANDARD: FlowEndpoints = {
    init: '/payment/iyzipos/checkoutform/initialize/auth/ecom',
    retrieve: '/payment/iyzipos/checkoutform/auth/ecom/detail',
    retrieveTokenField: 'token',
};

const SUBSCRIPTION: FlowEndpoints = {
    init: '/v1/pay-with-iyzico/third-party-session/checkout/init',
    retrieve: '/v1/pay-with-iyzico/third-party-session/retrieve/payment',
    retrieveTokenField: 'checkoutFormToken',
};

const LOCALE = 'tr';

const TRANSACTION_BY_OUTCOME: Record<IyzicoPaymentResult['outcome'], { type: string; state: string }> = {
    Success: { type: 'Charge', state: 'Success' },
    Failure: { type: 'Charge', state: 'Failure' },
    Pending: { type: 'Charge', state: 'Pending' },
};

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

        return this.buildReturnUrl(payment, result, req.returnUrl);
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
            cart, payment, callbackUrl, clientIp, cardUserKey, this.conversationIdFor(payment),
        );

        const response = await this.iyzico.post<IyzicoInitializeResponse>(flow.init, request);

        if (response.status === 'Failure') {
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
        const result = toIyzicoPaymentResult(retrieve);

        await this.recordPaymentOnCommercetools(payment, result, token);

        if (result.outcome === 'Success') {
            if (result.cardUserKey && result.cardToken) {
                await this.storeCard(payment, cart, result);
            }

        }



        return result;
    }

    private async storeCard(
        payment: connectPaymentsSdk.Payment,
        cart: connectPaymentsSdk.Cart,
        result: IyzicoPaymentResult,
    ): Promise<void> {
        if (!cart.customerId) {
            this.logger.warn(`Card storage skipped: guest cart on payment ${payment.id}`);
            return;
        }

        if (!result.cardUserKey || !result.cardToken) {
            this.logger.warn(`No card token on payment ${payment.id} — nothing to store`);
            return;
        }

        try {
            const saved = await this.iyzicoCardService.saveCard(cart.customerId, {
                cardUserKey: result.cardUserKey,
                cardToken: result.cardToken,
                brand: result.cardBrand,
                lastFourDigits: result.lastFourDigits,
                bin: result.binNumber,
            });

            await this.ctPayment.updatePayment({
                id: payment.id,
                customFieldValues: { cardId: saved.id },
            });

            this.logger.log(`Card stored as PaymentMethod ${saved.id} for customer ${cart.customerId}`);
        } catch (error) {
            this.logger.error(`Could not save card for payment ${payment.id}: ${error}`);
        }
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
                    conversationId: result.conversationId
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
        result: IyzicoPaymentResult,
        returnUrl?: string,
    ): string {
        if (!returnUrl) {
            this.logger.warn(`No returnUrl on callback for payment ${payment.id}`);
            throw new InternalServerErrorException('No return URL available');
        }
        const url = new URL(returnUrl);
        url.searchParams.set('paymentReference', payment.id);
        return url.toString();
    }
}