import {
  iyzicoCreatedPaymentResponseSchema,
  iyzicoPaymentDetailResponseSchema,
  iyzicoPaymentReportResponseSchema,
} from '../../../src/iyzico/contracts/payment-check.schema';

describe('Iyzico payment check schemas', () => {
  it('validates the complete payment response needed by the payment/refund check', () => {
    expect(
      iyzicoCreatedPaymentResponseSchema.safeParse({
        basketId: 'basket-1',
        conversationId: 'payment-1',
        currency: 'TRY',
        fraudStatus: 1,
        itemTransactions: [
          {
            itemId: 'item-1',
            paidPrice: 1.2,
            paymentTransactionId: 'transaction-1',
            price: 1.2,
          },
        ],
        paidPrice: 1.2,
        paymentId: 'iyzico-payment-1',
        paymentStatus: null,
        price: 1.2,
        signature: 'signature-1',
        status: 'success',
      }).success,
    ).toBe(true);
    expect(
      iyzicoCreatedPaymentResponseSchema.safeParse({
        basketId: 'basket-1',
        conversationId: 'payment-1',
        currency: 'TRY',
        status: 'success',
      }).success,
    ).toBe(false);

    expect(
      iyzicoPaymentDetailResponseSchema.safeParse({
        basketId: 'basket-1',
        conversationId: 'detail-1',
        currency: 'TRY',
        fraudStatus: 1,
        itemTransactions: [
          {
            itemId: 'item-1',
            paidPrice: 1.2,
            paymentTransactionId: 'transaction-1',
            price: 1.2,
          },
        ],
        paidPrice: 1.2,
        paymentId: 'iyzico-payment-1',
        paymentStatus: 'SUCCESS',
        price: 1.2,
        signature: 'signature-1',
        status: 'success',
      }).success,
    ).toBe(true);
  });

  it.each([
    'BANK_FAIL',
    'CALLBACK_THREEDS',
    'FAILURE',
    'INIT_THREEDS',
    'PENDING_CREDIT',
    'SUCCESS',
  ])('accepts a retrieved payment with paymentStatus %s', (paymentStatus) => {
    expect(
      iyzicoPaymentDetailResponseSchema.safeParse({
        basketId: 'basket-1',
        conversationId: 'detail-1',
        currency: 'TRY',
        fraudStatus: 1,
        itemTransactions: [
          {
            itemId: 'item-1',
            paidPrice: 1.2,
            paymentTransactionId: 'transaction-1',
            price: 1.2,
          },
        ],
        paidPrice: 1.2,
        paymentId: 'iyzico-payment-1',
        paymentStatus,
        price: 1.2,
        signature: 'signature-1',
        status: 'success',
      }).success,
    ).toBe(true);
  });

  it('validates the reporting evidence for a completed refund', () => {
    expect(
      iyzicoPaymentReportResponseSchema.safeParse({
        conversationId: 'report-1',
        payments: [
          {
            currency: 'TRY',
            itemTransactions: [
              {
                paymentTransactionId: 123,
                refunds: [
                  {
                    currencyCode: 'TRY',
                    refundConversationId: 'refund-1',
                    refundPrice: 1.2,
                    refundStatus: 1,
                  },
                ],
              },
            ],
            paidPrice: 1.2,
            paymentId: 456,
            paymentRefundStatus: 'TOTALLY_REFUNDED',
            price: 1.2,
          },
        ],
        status: 'success',
      }).success,
    ).toBe(true);
  });
});
