import { BadRequestException, Inject, Injectable, Logger, UseGuards } from "@nestjs/common";
import * as connectPaymentsSdk from '@commercetools/connect-payments-sdk';
import { IyzicoClient } from "./iyzico.client";
import type { TransactionDraft, TransactionResponse } from "../operations/transaction.dto";
import { CT_CART_SERVICE, CT_PAYMENT_SERVICE, CT_PAYMENT_METHOD_SERVICE } from "../commercetools/tokens";
import { unpackCardToken } from "./converters/iyzico-card-storage.converter";
import { IyzicoNon3dsResponse, toIyzicoNon3dsRequest } from "./converters/iyzico-non-3ds.converter";


const NON_3DS_PAYMENT_ENDPOINT = '/payment/auth';


const toMoney = (m: connectPaymentsSdk.Money): connectPaymentsSdk.Money => ({
    centAmount: Math.round(Number(m.centAmount)),
    currencyCode: String(m.currencyCode).toUpperCase(),
});


@Injectable()
export class IyzicoRecurringService {
    private readonly logger = new Logger(IyzicoRecurringService.name);

    constructor(
        private readonly iyzico: IyzicoClient,
        @Inject(CT_CART_SERVICE) private readonly ctCart: connectPaymentsSdk.CommercetoolsCartService,
        @Inject(CT_PAYMENT_SERVICE) private readonly ctPayment: connectPaymentsSdk.CommercetoolsPaymentService,
        @Inject(CT_PAYMENT_METHOD_SERVICE) private readonly ctPaymentMethods: connectPaymentsSdk.CommercetoolsPaymentMethodService,
    ) { }

    async handleTransaction(draft: TransactionDraft, cart: connectPaymentsSdk.Cart): Promise<TransactionResponse> {
        const rawAmount = draft.transactionItems?.[0]?.amount;
        if (!rawAmount || !Number.isFinite(Number(rawAmount.centAmount)) || !rawAmount.currencyCode) {
            throw new BadRequestException(
                `Transaction ${draft.key} has no valid amount: ${JSON.stringify(rawAmount)}`,
            );
        }
        const amount = toMoney(rawAmount);

        const paymentMethod = await this.resolvePaymentMethod(cart);
        const { cardToken, cardUserKey} = unpackCardToken(paymentMethod.token!.value);

        const payment = await this.ctPayment.createPayment({
            amountPlanned: amount,
            paymentMethodInfo: { paymentInterface: 'iyzico' },
        });

        const freshCart = await this.ctCart.getCart({ id: cart.id });
        await this.ctCart.addPayment({ resource: freshCart, paymentId: payment.id });

        await this.ctPayment.updatePayment({
            id: payment.id,
            transaction: { type: 'Charge', state: 'Initial', amount },
        });

        try {
            const response = await this.iyzico.post<IyzicoNon3dsResponse>(
                NON_3DS_PAYMENT_ENDPOINT,
                toIyzicoNon3dsRequest(cart, payment, amount, cardUserKey, cardToken),
            );

            const isSuccess = response.status === 'success'
                && response.fraudStatus !== -1;

            await this.ctPayment.updatePayment({
                id: payment.id,
                pspReference: String(response.paymentId ?? ''),
                paymentMethod: response.cardAssociation,
                transaction: {
                    type: 'Charge',
                    state: isSuccess ? 'Success' : 'Failure',
                    amount,
                    interactionId: response.conversationId,
                },
                pspInteractions: [
                    connectPaymentsSdk.GenerateInterfaceInteractionCustomFieldsDraft({
                        interactionId: response.conversationId,
                        createdAt: new Date().toISOString(),
                        type: `iyzico-refill-${isSuccess ? 'success' : 'failure'}`,
                        response: JSON.stringify({
                            status: response.status,
                            paymentId: response.paymentId,
                            fraudStatus: response.fraudStatus,
                            errorCode: response.errorCode,
                            errorMessage: response.errorMessage,
                        }),
                    }),
                ],
            });

            return {
                id: payment.id,
                version: 1,
                key: draft.key,
                transactionStatus: {
                    state: isSuccess ? 'Completed' : 'Failed',
                    ...(isSuccess ? {} : {
                        errors: [{
                            code: response.errorCode ?? 'IyzicoError',
                            message: response.errorMessage ?? 'Payment failed',
                        }],
                    }),
                },
            };
        } catch (err: any) {
            this.logger.error(`Recurring payment failed for cart ${cart.id}: ${err.message}`);

            await this.ctPayment.updatePayment({
                id: payment.id,
                transaction: { type: 'Charge', state: 'Failure', amount },
            }).catch(() => undefined);

            return {
                id: payment.id,
                version: 1,
                key: draft.key,
                transactionStatus: {
                    state: 'Failed',
                    errors: [{ code: 'IyzicoError', message: err.message }],
                },
            };
        }
    }

    private async resolvePaymentMethod(cart: connectPaymentsSdk.Cart): Promise<connectPaymentsSdk.PaymentMethod> {
        if (!cart.customerId) {
            throw new BadRequestException('Recurring payment requires an authenticated customer');
        }

        const paymentMethodId = cart.custom?.fields?.paymentMethodId as string | undefined;

        if (!paymentMethodId) {
            throw new BadRequestException(
                `No paymentMethodId on cart ${cart.id} — the caller must designate the stored payment method to charge`,
            );
        }

        return this.ctPaymentMethods.get({
            id: paymentMethodId,
            customerId: cart.customerId,
            paymentInterface: 'iyzico',
        });
    }
}

