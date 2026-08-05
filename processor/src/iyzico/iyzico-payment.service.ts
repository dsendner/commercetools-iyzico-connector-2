import { Inject, Injectable, InternalServerErrorException, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import * as connectPaymentsSdk from '@commercetools/connect-payments-sdk';
import { IyzicoInitializeResponse, toIyzicoInitializeRequest } from './converters/iyzico-create-session.converter';
import { IyzicoClient } from './iyzico.client';
import { getRequestContext } from '../commercetools/request-context';
import { buildCallbackUrl } from './helper.converter';
import { IyzicoPaymentResult, IyzicoRetrieveResponse, handleIyzicoError, toIyzicoPaymentResult } from './converters/iyzico-retrieve-payment.converter';
import { PaymentResponse } from './iyzico-payment.type';
import { IyzicoWebhookPayload } from './converters/webhook.converter';
import { toSavedCard as toSavedCard, unpackCardToken } from './converters/iyzico-card-storage.converter';
import { IyzicoCardService } from './iyzico-card.service';
import { TransactionDraft, TransactionResponse } from '../operations/transaction.dto';
import { IyzicoNon3dsResponse, toIyzicoNon3dsRequest } from './converters/iyzico-non-3ds.converter';
import { CT_CART_SERVICE, CT_PAYMENT_METHOD_SERVICE, CT_PAYMENT_SERVICE } from '../commercetools/tokens';
import { AppConfigService } from '../config/config.service';

export interface CreateSessionRequest {
    cartId: string;
    clientIp: string;
}

export interface CreateSessionResponse {
    paymentReference: string;
    checkoutFormContent: string;
    paymentPageUrl: string;
}


const TRANSACTION_BY_OUTCOME: Record<string, { type: string; state: string }> = {
    Success: { type: 'Charge', state: 'Success' },
    Failure: { type: 'Charge', state: 'Failure' },
    Pending: { type: 'Charge', state: 'Pending' },
};

function settledChargeState(payment: connectPaymentsSdk.Payment): 'Success' | 'Failure' | undefined {
    const charge = (payment.transactions ?? []).find(t => t.type === 'Charge');
    if (charge?.state === 'Success') {
        return charge.state as 'Success' | 'Failure';
    }
    return undefined;
}

const INITIALIZE_ENDPOINT = '/payment/iyzipos/checkoutform/initialize/auth/ecom';
const RETRIEVE_ENDPOINT = '/payment/iyzipos/checkoutform/auth/ecom/detail';

const PWI_INIT_ENDPOINT = '/v1/pay-with-iyzico/third-party-session/checkout/init';
const PWI_RETRIEVE_ENDPOINT = '/v1/pay-with-iyzico/third-party-session/retrieve/payment';

const toMoney = (m: connectPaymentsSdk.Money): connectPaymentsSdk.Money => ({ centAmount: m.centAmount, currencyCode: m.currencyCode });

@Injectable()
export class IyzicoPaymentService {
    private readonly logger = new Logger(IyzicoPaymentService.name);

    constructor(
        @Inject(CT_CART_SERVICE) private readonly ctCart: connectPaymentsSdk.CommercetoolsCartService,
        @Inject(CT_PAYMENT_SERVICE) private readonly ctPayment: connectPaymentsSdk.CommercetoolsPaymentService,
        @Inject(CT_PAYMENT_METHOD_SERVICE) private readonly ctPaymentMethods: connectPaymentsSdk.CommercetoolsPaymentMethodService,
        private readonly iyzico: IyzicoClient,
        private readonly iyzicoCardService: IyzicoCardService,
        private readonly config: AppConfigService,
    ) { }

    async createSession(req: CreateSessionRequest): Promise<CreateSessionResponse> {
        const cart = await this.ctCart.getCart({ id: req.cartId });

        const isSubscription = this.isSubscriptionCart(cart);

        const payment = await this.ctPayment.createPayment({
            amountPlanned: toMoney(cart.totalPrice),
            paymentMethodInfo: { paymentInterface: 'iyzico' },
        });

        const customerId = cart?.customerId;
        let cardUserKey: string | undefined;

        if (customerId) {
            cardUserKey = await this.iyzicoCardService.getUserKey(customerId);
        }

        const callbackUrl = this.callbackUrlFor(payment.id);
        this.logger.log(`CART = ${JSON.stringify(cart)}`);

        const checkoutFormInitResponse = await this.initCheckoutForm(
            cart,
            payment,
            callbackUrl,
            req.clientIp,
            cardUserKey,
            isSubscription,
        );

        await this.ctPayment.updatePayment({
            id: payment.id,
            pspReference: checkoutFormInitResponse.token,
            transaction: {
                type: 'Charge',
                state: 'Initial',
                amount: toMoney(cart.totalPrice),
                interactionId: checkoutFormInitResponse.token,
            },
            pspInteractions: [
                connectPaymentsSdk.GenerateInterfaceInteractionCustomFieldsDraft({
                    interactionId: checkoutFormInitResponse.token,
                    createdAt: new Date().toISOString(),
                    type: 'iyzico-checkout-form',
                    response: JSON.stringify({
                        paymentPageUrl: checkoutFormInitResponse.paymentPageUrl,
                    })
                })
            ]
        });

        await this.ctCart.addPayment({
            resource: cart,
            paymentId: payment.id,
        });

        return {
            paymentReference: payment.id,
            checkoutFormContent: checkoutFormInitResponse.checkoutFormContent,
            paymentPageUrl: checkoutFormInitResponse.paymentPageUrl,
        };
    }

    async handleCallback(req: { token: string; returnUrl?: string }): Promise<string> {
        const payment = await this.findPaymentByToken(req.token);

        const paymentResult = await this.finalizePayment(payment, req.token);

        const result: PaymentResponse = {
            paymentReference: payment.id,
            paymentStatus: paymentResult.paymentStatus,
            ...handleIyzicoError(paymentResult)
        };

        if (!req.returnUrl) {
            throw new Error('No return URL provided');
            //TODO Fallback 
        }
        const redirect = new URL(req.returnUrl);
        redirect.searchParams.set('paymentReference', result.paymentReference);
        redirect.searchParams.set('paymentStatus', result.paymentStatus);

        if (result.errorCode) {
            redirect.searchParams.set('errorCode', result.errorCode);
        }

        if (result.errorMessage) {
            redirect.searchParams.set('errorMessage', result.errorMessage);
        }

        return redirect.toString();
    }

    async handleWebhook(payload: IyzicoWebhookPayload, signature: string): Promise<void> {
        if (!this.iyzico.verifyWebhookSignature(payload, signature)) {
            throw new UnauthorizedException("Invalid webhook signature");
        }

        const payment = await this.findPaymentByToken(payload.token).catch(() => undefined);

        if (!payment) {
            this.logger.warn(`Webhook for an unknown token ${payload.iyziEventTime} - Ignored`);
            return;
        }
        await this.finalizePayment(payment, payload.token);
    }

    private isSubscriptionCart(cart: connectPaymentsSdk.Cart): boolean {
        const field = this.config.get('SUBSCRIPTION_DETECTION_FIELD');
        const withCode = cart.lineItems.filter(li => li.custom?.fields?.[field] != null);

        this.logger.log(
            `Cart ${cart.id}: ${withCode.length}/${cart.lineItems.length} lineItems with ${field}`,
        );

        return withCode.length > 0;
    }

    private async retrieveIyzicoPayment(paymentId: string, token: string, isSubscription: boolean): Promise<IyzicoPaymentResult> {

        const endpoint = isSubscription ? PWI_RETRIEVE_ENDPOINT : RETRIEVE_ENDPOINT;

        const paymentresult = await this.iyzico.post<IyzicoRetrieveResponse>(endpoint, {
            locale: 'tr',
            conversationId: paymentId,
            ...(isSubscription ? { checkoutFormToken: token } : { token }),
        });

        this.logger.log(`RAW RETRIEVE: ${JSON.stringify(paymentresult, null, 2)}`);

        return toIyzicoPaymentResult(paymentresult);
    }

    private async findPaymentByToken(token: string): Promise<connectPaymentsSdk.Payment> {
        const [payment] = await this.ctPayment.findPaymentsByInterfaceId({ interfaceId: token });
        if (!payment) {
            throw new NotFoundException(`Payment with Iyzico token ${token} not found`);
        }
        return payment;
    }

    private async recordPaymentOnCommercetools(
        payment: connectPaymentsSdk.Payment,
        iyzicoPaymentResult: IyzicoPaymentResult,
        token: string
    ): Promise<void> {
        const { type, state } = TRANSACTION_BY_OUTCOME[iyzicoPaymentResult.paymentStatus];

        await this.ctPayment.updatePayment({
            id: payment.id,
            paymentMethod: iyzicoPaymentResult.cardBrand,
            transaction: {
                type,
                state,
                amount: toMoney(payment.amountPlanned),
                interactionId: token
            },

            pspInteractions: [
                connectPaymentsSdk.GenerateInterfaceInteractionCustomFieldsDraft({
                    interactionId: token,
                    createdAt: new Date().toISOString(),
                    type: `iyzico-confirm-${iyzicoPaymentResult.paymentStatus.toLocaleLowerCase()}`,
                    response: JSON.stringify({
                        paymentStatus: iyzicoPaymentResult.paymentStatus,
                        fraudStatus: iyzicoPaymentResult.fraudStatus,
                        errorCode: iyzicoPaymentResult.errorCode,
                        errorMessage: iyzicoPaymentResult.errorMessage,
                    })
                })
            ]
        });
    }

    private async recordCardMetadata(
        payment: connectPaymentsSdk.Payment,
        iyzicoResult: IyzicoRetrieveResponse,
    ): Promise<void> {
        await this.ctPayment.updatePayment({
            id: payment.id,
            customFields: {
                type: { key: 'iyzico-payment-card-info', typeId: 'type' },
                fields: {
                    cardType: iyzicoResult.cardType,
                    cardAssociation: iyzicoResult.cardAssociation,
                    cardFamily: iyzicoResult.cardFamily,
                    binNumber: iyzicoResult.binNumber,
                    lastFourDigits: iyzicoResult.lastFourDigits,
                },
            },
        });
    }

    private async initCheckoutForm(
        cart: connectPaymentsSdk.Cart,
        payment: connectPaymentsSdk.Payment,
        callbackUrl: string,
        clientIp: string,
        cardUserKey?: string,
        isSubscription = false,
    ): Promise<IyzicoInitializeResponse> {
        const iyzicoRequest = toIyzicoInitializeRequest(cart, payment, callbackUrl, clientIp, cardUserKey);

        const endpoint = isSubscription ? PWI_INIT_ENDPOINT : INITIALIZE_ENDPOINT;

        const response = await this.iyzico.post<IyzicoInitializeResponse>(endpoint, iyzicoRequest);

        if (response.status === 'Failure') {
            this.logger.error(`Iyzico init failed: [${response.errorCode}] ${response.errorMessage}`);
            throw new InternalServerErrorException('Could not start the checkout init payment');
        }

        return response;
    }

    private callbackUrlFor(id: string): string {
        const ctx = getRequestContext();
        const baseUrl = connectPaymentsSdk.getProcessorUrlFromContext(ctx) ?? process.env.PROCESSOR_PUBLIC_URL;

        if (!baseUrl) {
            throw new InternalServerErrorException('Could not determine processor URL');
        }

        const merchantReturnUrl = connectPaymentsSdk.getMerchantReturnUrlFromContext(ctx) ?? process.env.DEFAULT_RETURN_URL;

        return buildCallbackUrl(baseUrl, id, connectPaymentsSdk.getCtSessionIdFromContext(ctx), merchantReturnUrl);
    }

    private async finalizePayment(payment: connectPaymentsSdk.Payment, token: string): Promise<IyzicoPaymentResult> {
        const settled = settledChargeState(payment);

        const cart = await this.ctCart.getCartByPaymentId({ paymentId: payment.id }).catch(() => undefined);
        if (!cart) {
            this.logger.warn(`Cart not found for payment ${payment.id}`);
            return {
                iyzicoPaymentId: payment.id,
                paymentStatus: 'Failure',
                errorMessage: 'Cart not found',
            };
        }
        if (settled) {
            return {
                iyzicoPaymentId: payment.id,
                paymentStatus: settled,
                errorMessage: settled === 'Failure' ? 'Payment could not be completed' : undefined,
            };
        }
        const isSubscription = this.isSubscriptionCart(cart);
        const paymentResult = await this.retrieveIyzicoPayment(payment.id, token, isSubscription);

        await this.recordPaymentOnCommercetools(payment, paymentResult, token);
        await this.saveCardIfPresent(payment, paymentResult);
        return paymentResult;
    }

    private async saveCardIfPresent(payment: connectPaymentsSdk.Payment, paymentResult: IyzicoPaymentResult): Promise<void> {
        const savedCard = toSavedCard(paymentResult);

        if (!savedCard) {
            return;
        }
        try {
            const cart = await this.ctCart.getCartByPaymentId({ paymentId: payment.id });

            if (!cart || !cart.customerId) {
                this.logger.warn(`Card storage skipped: Payment ${payment.id} is associated with a guest cart.`);
                return;
            }

            const savedPaymentMethod = await this.iyzicoCardService.saveCard(cart.customerId, savedCard);

            if (savedPaymentMethod?.id) {
                await this.ctPayment.updatePayment({
                    id: payment.id,
                    customFieldValues: {
                        cardId: savedPaymentMethod.id,
                    },
                });
            }
        } catch (error) {
            this.logger.error(`Could not save card for payment ${payment.id}: ${error}`);
        }
    }
}
