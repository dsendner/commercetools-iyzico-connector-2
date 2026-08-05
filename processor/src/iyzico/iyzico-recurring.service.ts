import { BadRequestException, ForbiddenException, Inject, Injectable, InternalServerErrorException, Logger, NotFoundException } from "@nestjs/common";
import * as connectPaymentsSdk from '@commercetools/connect-payments-sdk';
import { IyzicoClient } from "./iyzico.client";
import { TransactionDraft, TransactionResponse } from "../operations/transaction.dto";
import { CT_CART_SERVICE, CT_PAYMENT_SERVICE, CT_PAYMENT_METHOD_SERVICE } from "../commercetools/tokens";
import { Cart, CentPrecisionMoney, PaymentMethod } from "@commercetools/platform-sdk";
import { unpackCardToken } from "./converters/iyzico-card-storage.converter";
import { IyzicoNon3dsResponse, toIyzicoNon3dsRequest } from "./converters/iyzico-non-3ds.converter";


const NON_3DS_PAYMENT_ENDPOINT = '/payment/auth';


const toMoney = (m: connectPaymentsSdk.Money): connectPaymentsSdk.Money => ({ centAmount: m.centAmount, currencyCode: m.currencyCode });


@Injectable()
export class IyzicoRecurringService {
    private readonly logger = new Logger(IyzicoRecurringService.name);

    constructor(
        private readonly iyzico: IyzicoClient,
        @Inject(CT_CART_SERVICE) private readonly ctCart: connectPaymentsSdk.CommercetoolsCartService,
        @Inject(CT_PAYMENT_SERVICE) private readonly ctPayment: connectPaymentsSdk.CommercetoolsPaymentService,
        @Inject(CT_PAYMENT_METHOD_SERVICE) private readonly ctPaymentMethods: connectPaymentsSdk.CommercetoolsPaymentMethodService,
    ) { }

    async handleTransaction(transactionDraft: TransactionDraft): Promise<TransactionResponse> {

        const cart = await this.ctCart.getCart({
            id: transactionDraft.cart.id,
            expand: ['paymentInfo.payments[*]'],
        });

        if (!cart.customerId) {
            throw new InternalServerErrorException(
                'Recurring payment requires an authenticated customer',
            );
        }

        const lastPayment = cart.paymentInfo?.payments?.[0]?.obj;
        const cardId = lastPayment?.custom?.fields?.cardId as string | undefined;

        if (!cardId) {
            throw new NotFoundException(
                `No cardId on payment for cart ${cart.id}`,
            );
        }

        const paymentMethod = await this.ctPaymentMethods.get({
            id: cardId,
            customerId: cart.customerId,
            paymentInterface: 'iyzico',
        });

        const token = paymentMethod[0]?.token?.value;
        if (!token) {
            throw new InternalServerErrorException(
                `No stored card token found for customer ${cart.customerId} — cannot process recurring payment`,
            );
        }

        const { cardUserKey, cardToken } = unpackCardToken(token.value);


        const payment = await this.ctPayment.createPayment({
            amountPlanned: toMoney(cart.totalPrice),
            paymentMethodInfo: { paymentInterface: 'iyzico' },
        });

        await this.ctPayment.updatePayment({
            id: payment.id,
            transaction: {
                type: 'Charge',
                state: 'Initial',
                amount: toMoney(cart.totalPrice),
            },
        });

        const izycoPaymentResponse = await this.iyzico.post<IyzicoNon3dsResponse>(NON_3DS_PAYMENT_ENDPOINT, {
            ...toIyzicoNon3dsRequest(cart, payment, cardToken, cardUserKey),
        });

        const isSuccess = izycoPaymentResponse.status === 'success' && izycoPaymentResponse.fraudStatus === 1;

        await this.ctPayment.updatePayment({
            id: payment.id,
            pspReference: izycoPaymentResponse.paymentId,
            transaction: {
                type: 'Charge',
                state: isSuccess ? 'Success' : 'Failure',
                amount: toMoney(cart.totalPrice),
                interactionId: izycoPaymentResponse.conversationId,
            },
            pspInteractions: [
                connectPaymentsSdk.GenerateInterfaceInteractionCustomFieldsDraft({
                    interactionId: izycoPaymentResponse.conversationId,
                    createdAt: new Date().toISOString(),
                    type: 'iyzico-refill',
                    response: JSON.stringify({
                        status: izycoPaymentResponse.status,
                        paymentId: izycoPaymentResponse.paymentId,
                        fraudStatus: izycoPaymentResponse.fraudStatus,
                        errorCode: izycoPaymentResponse.errorCode,
                        errorMessage: izycoPaymentResponse.errorMessage,
                    }),
                }),
            ],
        });

        return {
            id: payment.id,
            version: 1,
            key: transactionDraft.key,
            transactionStatus: {
                state: isSuccess ? 'Completed' : 'Failed',
                ...(isSuccess
                    ? {}
                    : {
                        errors: [
                            {
                                code: izycoPaymentResponse.errorCode ?? 'IyzicoError',
                                message: izycoPaymentResponse.errorMessage ?? 'Payment failed',
                            },
                        ],
                    }),
            },
        };
    }

    private async resolvePaymentMethod(cart: Cart): Promise<PaymentMethod> {
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

