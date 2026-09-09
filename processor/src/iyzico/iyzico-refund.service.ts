import * as connectPaymentsSdk from '@commercetools/connect-payments-sdk';
import {
  BadGatewayException,
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';

import { CT_PAYMENT_SERVICE } from '../commercetools/tokens';
import {
  storedIyzicoPaymentInteractionSchema,
  storedIyzicoRefundInteractionSchema,
} from './contracts/stored-interaction.schema';
import {
  PaymentIntentResponse,
  PaymentModificationStatus,
  RefundPaymentAction,
} from '../operations/payment-intents.dto';
import { IyzicoItemTransaction } from './contracts/item-transaction.schema';
import {
  IyzicoRefundRequest,
  IyzicoRefundResponse,
  iyzicoRefundResponseSchema,
} from './contracts/refund.schema';
import { IyzicoClient } from './iyzico.client';

const REFUND_ENDPOINT = '/payment/refund';
const LOCALE = 'tr';

@Injectable()
export class IyzicoRefundService {
  private readonly logger = new Logger('IyzicoRefundService');

  constructor(
    @Inject(CT_PAYMENT_SERVICE)
    private readonly ctPayment: connectPaymentsSdk.CommercetoolsPaymentService,
    private readonly iyzico: IyzicoClient,
  ) {}

  async refund(
    paymentId: string,
    action: RefundPaymentAction,
  ): Promise<PaymentIntentResponse> {
    const startedAt = Date.now();
    this.logger.log(
      JSON.stringify({ event: 'iyzico.refund.requested', paymentId }),
    );

    const payment = await this.ctPayment.getPayment({ id: paymentId });
    this.assertMatchesOrder(payment, action.merchantReference);

    if (this.hasCompletedRefund(payment, action)) {
      this.logger.log(
        JSON.stringify({ event: 'iyzico.refund.already_completed', paymentId }),
      );
      return { outcome: PaymentModificationStatus.Approved };
    }

    this.validatePayment(payment, action);
    const charge = this.getSuccessfulCharge(payment, action);
    const itemTransactions = this.getItemTransactions(payment, charge);

    await this.ctPayment.updatePayment({
      id: payment.id,
      transaction: {
        amount: action.amount,
        interactionId: action.merchantReference,
        state: 'Initial',
        type: 'Refund',
      },
    });

    const alreadyRefunded = this.getSuccessfullyRefundedItems(payment);
    const pendingRefunds = itemTransactions
      .filter((item) => !alreadyRefunded.has(item.paymentTransactionId))
      .map((item) => ({
        item,
        request: this.buildRefundRequest(action, item),
      }));
    this.logger.log(
      JSON.stringify({
        event: 'iyzico.refund.processing',
        itemCount: itemTransactions.length,
        paymentId,
        pendingItemCount: pendingRefunds.length,
        skippedItemCount: itemTransactions.length - pendingRefunds.length,
      }),
    );
    const results = await Promise.allSettled(
      pendingRefunds.map(async ({ request }) => {
        const rawResponse = await this.iyzico.post<unknown>(
          REFUND_ENDPOINT,
          request,
        );
        const response = this.parseRefundResponse(rawResponse);
        this.validateSuccessfulResponse(response, request);
        return response;
      }),
    );

    const { pspInteractions, successfulItemCount } = results.reduce(
      (accumulator, result, index) => {
        const { item, request } = pendingRefunds[index];
        const response =
          result.status === 'fulfilled'
            ? result.value
            : {
                errorCode: 'connector_error',
                errorMessage: this.getErrorMessage(result.reason),
                retryable: undefined,
                status: 'failure' as const,
              };
        const successful = response.status === 'success';

        if (successful) {
          accumulator.successfulItemCount += 1;
          this.logger.log(
            JSON.stringify({
              event: 'iyzico.refund.item_succeeded',
              itemNumber: index + 1,
              paymentId,
            }),
          );
        } else {
          this.logger.error(
            JSON.stringify({
              errorCode: response.errorCode ?? 'unknown',
              event: 'iyzico.refund.item_failed',
              itemNumber: index + 1,
              paymentId,
              retryable: response.retryable,
            }),
          );
        }

        accumulator.pspInteractions.push(
          connectPaymentsSdk.GenerateInterfaceInteractionCustomFieldsDraft({
            createdAt: new Date().toISOString(),
            interactionId:
              response.paymentTransactionId ?? item.paymentTransactionId,
            request: JSON.stringify(request),
            response: JSON.stringify({
              ...response,
              merchantReference: action.merchantReference,
              originalPaymentTransactionId: item.paymentTransactionId,
            }),
            type: `iyzico-refund-${successful ? 'success' : 'failure'}`,
          }),
        );
        return accumulator;
      },
      {
        pspInteractions: [] as connectPaymentsSdk.CustomFieldsDraft[],
        successfulItemCount: 0,
      },
    );
    const allSuccessful = successfulItemCount === results.length;

    await this.updateRefundState(
      payment.id,
      action,
      allSuccessful ? 'Success' : 'Failure',
      pspInteractions,
    );

    const completionLog = JSON.stringify({
      durationMs: Date.now() - startedAt,
      event: 'iyzico.refund.completed',
      failedItemCount: results.length - successfulItemCount,
      outcome: allSuccessful
        ? PaymentModificationStatus.Approved
        : PaymentModificationStatus.Rejected,
      paymentId,
      successfulItemCount,
    });
    if (allSuccessful) this.logger.log(completionLog);
    else this.logger.warn(completionLog);

    const technicalFailure = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    if (technicalFailure) {
      if (technicalFailure.reason instanceof Error)
        throw technicalFailure.reason;
      throw new BadGatewayException('Iyzico refund request failed');
    }

    return {
      outcome: allSuccessful
        ? PaymentModificationStatus.Approved
        : PaymentModificationStatus.Rejected,
    };
  }

  private assertMatchesOrder(
    payment: connectPaymentsSdk.Payment,
    merchantReference: string,
  ): void {
    if (payment.custom?.fields?.conversationId !== merchantReference) {
      throw new BadRequestException(
        `Payment ${payment.id} does not belong to order ${merchantReference}`,
      );
    }
  }

  private buildRefundRequest(
    action: RefundPaymentAction,
    item: IyzicoItemTransaction,
  ): IyzicoRefundRequest {
    return {
      conversationId: `${action.merchantReference}-${item.itemId}`,
      currency: action.amount.currencyCode,
      locale: LOCALE,
      paymentTransactionId: item.paymentTransactionId,
      price: String(item.price),
    };
  }

  private getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Unknown connector error';
  }

  private getItemTransactions(
    payment: connectPaymentsSdk.Payment,
    charge: connectPaymentsSdk.Payment['transactions'][number],
  ): IyzicoItemTransaction[] {
    for (const interaction of [
      ...(payment.interfaceInteractions ?? []),
    ].reverse()) {
      const type = String(interaction.fields?.type ?? '');
      if (type !== 'iyzico-confirm-success' && type !== 'iyzico-refill-success')
        continue;
      if (
        charge.interactionId &&
        interaction.fields?.interactionId !== charge.interactionId
      )
        continue;

      try {
        const response = storedIyzicoPaymentInteractionSchema.safeParse(
          JSON.parse(String(interaction.fields.response)),
        );
        if (response.success) return response.data.itemTransactions;
      } catch {
        // Continue looking through older Iyzico interactions.
      }
    }

    throw new BadRequestException(
      `Payment ${payment.id} has no Iyzico item transaction references`,
    );
  }

  private getSuccessfulCharge(
    payment: connectPaymentsSdk.Payment,
    action: RefundPaymentAction,
  ): connectPaymentsSdk.Payment['transactions'][number] {
    const successfulCharges = payment.transactions.filter(
      (transaction) =>
        transaction.type === 'Charge' && transaction.state === 'Success',
    );

    if (action.transactionId) {
      const charge = successfulCharges.find(
        (transaction) => transaction.id === action.transactionId,
      );
      if (!charge) {
        throw new BadRequestException(
          `Payment ${payment.id} has no successful Charge transaction ${action.transactionId}`,
        );
      }
      return charge;
    }

    if (successfulCharges.length !== 1) {
      throw new BadRequestException(
        `Payment ${payment.id} must have exactly one successful Charge when transactionId is omitted`,
      );
    }

    return successfulCharges[0];
  }

  /**
   * An item that was ever successfully refunded must never be sent to Iyzico again,
   * no matter which merchantReference the caller used for that earlier attempt.
   * merchantReference is not an access check, it carries no authorization; the
   * OAuth2 scope guard on the endpoint is what decides who may call this. Filtering
   * this history by reference would only make the connector forget refunds it has
   * already completed, and resend money that Iyzico already paid back.
   */
  private getSuccessfullyRefundedItems(
    payment: connectPaymentsSdk.Payment,
  ): Set<string> {
    const result = new Set<string>();
    for (const interaction of payment.interfaceInteractions ?? []) {
      if (interaction.fields?.type !== 'iyzico-refund-success') continue;
      try {
        const response = storedIyzicoRefundInteractionSchema.safeParse(
          JSON.parse(String(interaction.fields.response)),
        );
        if (response.success) {
          result.add(response.data.originalPaymentTransactionId);
        }
      } catch {
        // Ignore unrelated legacy interactions with non-JSON response fields.
      }
    }
    return result;
  }

  private hasCompletedRefund(
    payment: connectPaymentsSdk.Payment,
    action: RefundPaymentAction,
  ): boolean {
    return payment.transactions.some(
      (transaction) =>
        transaction.type === 'Refund' &&
        transaction.state === 'Success' &&
        transaction.interactionId === action.merchantReference &&
        transaction.amount.centAmount === action.amount.centAmount &&
        transaction.amount.currencyCode === action.amount.currencyCode,
    );
  }

  private parseRefundResponse(response: unknown): IyzicoRefundResponse {
    const parsed = iyzicoRefundResponseSchema.safeParse(response);
    if (!parsed.success) {
      this.logger.error(
        JSON.stringify({
          event: 'iyzico.refund.invalid_response',
          issues: parsed.error.issues.map((issue) => ({
            code: issue.code,
            path: issue.path.join('.'),
          })),
        }),
      );
      throw new BadGatewayException(
        'Iyzico returned an invalid refund response',
      );
    }
    return parsed.data;
  }

  private async updateRefundState(
    paymentId: string,
    action: RefundPaymentAction,
    state: 'Failure' | 'Success',
    pspInteractions: connectPaymentsSdk.CustomFieldsDraft[],
  ): Promise<void> {
    await this.ctPayment.updatePayment({
      id: paymentId,
      pspInteractions,
      transaction: {
        amount: action.amount,
        interactionId: action.merchantReference,
        state,
        type: 'Refund',
      },
    });
  }

  private validatePayment(
    payment: connectPaymentsSdk.Payment,
    action: RefundPaymentAction,
  ): void {
    if (payment.paymentMethodInfo.paymentInterface !== 'iyzico') {
      throw new BadRequestException(
        `Payment ${payment.id} is not an Iyzico payment`,
      );
    }

    if (
      action.amount.currencyCode !== payment.amountPlanned.currencyCode ||
      action.amount.centAmount !== payment.amountPlanned.centAmount
    ) {
      throw new BadRequestException(
        'Iyzico refunds currently support the full payment amount only',
      );
    }

    const otherCompletedRefund = payment.transactions.some(
      (transaction) =>
        transaction.type === 'Refund' &&
        transaction.state === 'Success' &&
        transaction.amount.centAmount === action.amount.centAmount &&
        transaction.amount.currencyCode === action.amount.currencyCode,
    );
    if (otherCompletedRefund) {
      throw new BadRequestException(
        `Payment ${payment.id} is already refunded`,
      );
    }
  }

  private validateSuccessfulResponse(
    response: IyzicoRefundResponse,
    request: IyzicoRefundRequest,
  ): void {
    if (response.status !== 'success') return;

    if (
      response.conversationId !== request.conversationId ||
      response.currency !== request.currency ||
      response.paymentTransactionId !== request.paymentTransactionId ||
      response.price !== Number(request.price)
    ) {
      throw new BadGatewayException(
        'Iyzico refund response does not match the request',
      );
    }

    if (
      !this.iyzico.verifyResponseSignature(
        [
          response.paymentId,
          response.price,
          response.currency,
          response.conversationId,
        ],
        response.signature,
      )
    ) {
      throw new BadGatewayException(
        'Iyzico refund response has an invalid signature',
      );
    }
  }
}
