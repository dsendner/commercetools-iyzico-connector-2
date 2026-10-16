import * as connectPaymentsSdk from '@commercetools/connect-payments-sdk';
import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { CT_PAYMENT_SERVICE } from '../commercetools/tokens';
import { REFUND_APPROVED, REFUND_REJECTED, RefundOutcome } from '../operations/payment-intent.dto';
import { IyzicoRefundResponse, toIyzicoRefundRequest } from './converters/iyzico-refund.converter';
import { IyzicoClient } from './iyzico.client';

const REFUND_V2 = '/v2/payment/refund';
const LOCALE = 'tr';

/** Iyzico reports a payment that was already refunded or cancelled with this code. */
const ALREADY_REVERSED_ERROR_CODE = '5088';

export interface RefundRequest {
    amount: { centAmount: number; currencyCode: string };
    merchantReference?: string;
}

@Injectable()
export class IyzicoRefundService {
    private readonly logger = new Logger(IyzicoRefundService.name);

    constructor(
        @Inject(CT_PAYMENT_SERVICE) private readonly ctPayment: connectPaymentsSdk.CommercetoolsPaymentService,
        private readonly iyzico: IyzicoClient,
    ) { }

    async refundPayment(paymentId: string, request: RefundRequest): Promise<RefundOutcome> {
        const payment = await this.ctPayment.getPayment({ id: paymentId });

        const iyzicoPaymentId = this.iyzicoPaymentIdOf(payment);
        if (!iyzicoPaymentId) {
            this.logger.error(`No Iyzico payment id on payment ${payment.id}, it needs a manual refund`);
            throw new BadRequestException(`Payment ${payment.id} cannot be refunded, the Iyzico payment id is missing`);
        }

        const conversationId = payment.custom?.fields?.conversationId as string | undefined;
        if (request.merchantReference && conversationId && conversationId !== request.merchantReference) {
            throw new BadRequestException(
                `Payment ${payment.id} does not belong to order ${request.merchantReference}`,
            );
        }

        const amount = this.amountToRefund(payment, request);
        const response = await this.callRefund(payment, iyzicoPaymentId, amount, conversationId ?? payment.id);

        if (response.status === 'success') {
            this.logger.log(`Refunded payment ${payment.id} on Iyzico payment ${iyzicoPaymentId}`);
            await this.recordRefund(payment, amount, response);
            return REFUND_APPROVED;
        }

        if (response.errorCode === ALREADY_REVERSED_ERROR_CODE) {
            this.logger.log(
                `Iyzico payment ${iyzicoPaymentId} was already reversed, nothing to do for payment ${payment.id}`,
            );
            return REFUND_APPROVED;
        }

        this.logger.error(
            `Iyzico refused the refund for payment ${payment.id}, it needs a manual refund: `
            + `[${response.errorCode}] ${response.errorMessage}`,
        );
        await this.recordRefund(payment, amount, response);
        return REFUND_REJECTED;
    }

    private amountToRefund(
        payment: connectPaymentsSdk.Payment,
        request: RefundRequest,
    ): connectPaymentsSdk.Money & { fractionDigits?: number } {
        const { centAmount, currencyCode, fractionDigits } = payment.amountPlanned;

        if (request.amount.centAmount !== centAmount || request.amount.currencyCode !== currencyCode) {
            throw new BadRequestException(
                `Payment ${payment.id} can only be refunded in full, `
                + `asked for ${request.amount.centAmount} ${request.amount.currencyCode} `
                + `instead of ${centAmount} ${currencyCode}`,
            );
        }

        return { centAmount, currencyCode, fractionDigits };
    }

    private async callRefund(
        payment: connectPaymentsSdk.Payment,
        iyzicoPaymentId: string,
        amount: connectPaymentsSdk.Money & { fractionDigits?: number },
        conversationId: string,
    ): Promise<IyzicoRefundResponse> {
        try {
            return await this.iyzico.post<IyzicoRefundResponse>(
                REFUND_V2,
                toIyzicoRefundRequest(iyzicoPaymentId, amount, conversationId, LOCALE),
            );
        } catch (error) {
            this.logger.error(
                `The Iyzico refund call failed for payment ${payment.id}, `
                + `it is unknown whether the refund went through: ${error}`,
            );
            throw error;
        }
    }

    private iyzicoPaymentIdOf(payment: connectPaymentsSdk.Payment): string | undefined {
        const fromField = payment.custom?.fields?.iyzicoPaymentId;
        return typeof fromField === 'string' && fromField.length > 0 ? fromField : undefined;
    }

    private async recordRefund(
        payment: connectPaymentsSdk.Payment,
        amount: connectPaymentsSdk.Money,
        response: IyzicoRefundResponse,
    ): Promise<void> {
        const { currency, errorCode, errorMessage, paymentId, price, refundHostReference, retryable, status } = response;
        const state = status === 'success' ? 'Success' : 'Failure';
        const interactionId = refundHostReference ?? paymentId ?? payment.id;

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
                    type: `iyzico-refund-${state.toLowerCase()}`,
                    response: JSON.stringify({
                        currency,
                        errorCode,
                        errorMessage,
                        paymentId,
                        price,
                        refundHostReference,
                        retryable,
                        status,
                    }),
                }),
            ],
        }).catch((error) => {
            this.logger.error(`Could not record the refund on payment ${payment.id}: ${error}`);
        });
    }
}
