import { Inject, Injectable, InternalServerErrorException, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import {
    Cart,
    GenerateInterfaceInteractionCustomFieldsDraft,
    getCtSessionIdFromContext,
    getMerchantReturnUrlFromContext,
    getProcessorUrlFromContext,
    Payment,
    type CommercetoolsCartService,
    type CommercetoolsPaymentService,
    type Money,
} from '@commercetools/connect-payments-sdk';
import { CT_CART_SERVICE, CT_PAYMENT_SERVICE } from '../commercetools/commercetools.module';
import { IyzicoInitializeResponse, toIyzicoInitializeRequest } from './converters/iyzico-create-session.converter';
import { IyzicoClient } from './iyzico.client';
import { getRequestContext } from '../commercetools/request-context';
import { buildCallbackUrl } from './helper.converter';
import { IyzicoPaymentResult, IyzicoRetrieveResponse, handleIyzicoError, toIyzicoPaymentResult } from './converters/iyzico-retrieve-payment.converter';
import { PaymentResponse } from './iyzico-payment.type';
import { IyzicoWebhookPayload } from './converters/webhook.converter';
import { toSavedCard as toSavedCard } from './converters/iyzico-card-storage.converter';
import { IyzicoCardService } from './iyzico-card.service';

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

function settledChargeState(payment: Payment): 'Success' | 'Failure' | undefined {
    const charge = (payment.transactions ?? []).find(t => t.type === 'Charge');
    if (charge?.state === 'Success') {
        return charge.state as 'Success' | 'Failure';
    }
    return undefined;
}

const INITIALIZE_ENDPOINT = '/payment/iyzipos/checkoutform/initialize/auth/ecom';
const RETRIEVE_ENDPOINT = '/payment/iyzipos/checkoutform/auth/ecom/detail';

const toMoney = (m: Money): Money => ({ centAmount: m.centAmount, currencyCode: m.currencyCode });

@Injectable()
export class IyzicoPaymentService {
    private readonly logger = new Logger(IyzicoPaymentService.name);

    constructor(
        @Inject(CT_CART_SERVICE) private readonly ctCart: CommercetoolsCartService,
        @Inject(CT_PAYMENT_SERVICE) private readonly ctPayment: CommercetoolsPaymentService,
        private readonly iyzico: IyzicoClient,
        private readonly iyzicoCardService: IyzicoCardService,
    ) { }

    async createSession(req: CreateSessionRequest): Promise<CreateSessionResponse> {
        const cart = await this.ctCart.getCart({ id: req.cartId });
        const payment = await this.ctPayment.createPayment({
            amountPlanned: toMoney(cart.totalPrice),
            paymentMethodInfo: { paymentInterface: 'iyzico' },
        });

        const customerId = cart?.customerId
        let cardUserKey: string | undefined;

        if (customerId) {
            cardUserKey = await this.iyzicoCardService.getUserKey(customerId);
        }

        const callbackUrl = this.callbackUrlFor(payment.id);
        const checkoutFormInitResponse = await this.initCheckoutForm(
            cart,
            payment,
            callbackUrl,
            req.clientIp,
            cardUserKey
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
                GenerateInterfaceInteractionCustomFieldsDraft({
                    interactionId: checkoutFormInitResponse.token,
                    createdAt: new Date().toISOString(),
                    type: 'iyzico-checkout-form',
                    response: JSON.stringify({
                        checkoutFormContent: checkoutFormInitResponse.checkoutFormContent,
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

    private async retrieveIyzicoPayment(paymentId: string, token: string): Promise<IyzicoPaymentResult> {
        const paymentresult = await this.iyzico.post<IyzicoRetrieveResponse>(RETRIEVE_ENDPOINT, {
            locale: 'tr',
            conversationId: paymentId,
            token: token,
        });

        return toIyzicoPaymentResult(paymentresult);
    }

    private async findPaymentByToken(token: string): Promise<Payment> {
        const [payment] = await this.ctPayment.findPaymentsByInterfaceId({ interfaceId: token });
        if (!payment) {
            throw new NotFoundException(`Payment with Iyzico token ${token} not found`);
        }
        return payment;
    }

    private async recordPaymentOnCommercetools(
        payment: Payment,
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
                interactionId: token // 3. Fix: Use the token parameter ("tok-xyz") here
            },

            pspInteractions: [
                GenerateInterfaceInteractionCustomFieldsDraft({
                    interactionId: token, // 4. Fix: Use the token here as well
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

    private async initCheckoutForm(cart: Cart, payment: Payment, callbackUrl: string, clientIp: string, cardUserKey?: string): Promise<IyzicoInitializeResponse> {
        const iyzicoRequest = toIyzicoInitializeRequest(cart, payment, callbackUrl, clientIp, cardUserKey);

        const CheckoutFormInitResponse = await this.iyzico.post<IyzicoInitializeResponse>(
            INITIALIZE_ENDPOINT,
            iyzicoRequest,
        );

        if (CheckoutFormInitResponse.status === 'Failure') {
            this.logger.error(`Iyzico initialization failed: [${CheckoutFormInitResponse.errorCode}] ${CheckoutFormInitResponse.errorMessage}`);
            throw new InternalServerErrorException('Could not start the checkout init payment');
        }

        return CheckoutFormInitResponse;
    }

    private callbackUrlFor(id: string): string {
        const ctx = getRequestContext();
        const baseUrl = getProcessorUrlFromContext(ctx);

        if (!baseUrl) {
            throw new InternalServerErrorException('Could not determine processor URL');
        }

        return buildCallbackUrl(baseUrl, id, getCtSessionIdFromContext(ctx), getMerchantReturnUrlFromContext(ctx));
    }

    private async finalizePayment(payment: Payment, token: string): Promise<IyzicoPaymentResult> {
        const settled = settledChargeState(payment);
        if (settled) {
            return {
                iyzicoPaymentId: payment.id,
                paymentStatus: settled,
                errorMessage: settled === 'Failure' ? 'Payment could not be completed' : undefined,
            };
        }
        const paymentResult = await this.retrieveIyzicoPayment(payment.id, token);

        await this.recordPaymentOnCommercetools(payment, paymentResult, token);
        await this.saveCardIfPresent(payment, paymentResult);
        return paymentResult;
    }

    private async saveCardIfPresent(payment: Payment, paymentResult: IyzicoPaymentResult): Promise<void> {
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

            await this.iyzicoCardService.save(cart.customerId, savedCard);
        } catch (error) {
            this.logger.error(`Could not save card for payment ${payment.id}: ${error}`);
        }
    }
}
