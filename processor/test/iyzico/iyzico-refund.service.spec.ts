import type { Payment } from '@commercetools/connect-payments-sdk';

import { BadRequestException, Logger } from '@nestjs/common';

import { PaymentModificationStatus } from '../../src/operations/payment-intents.dto';
import { IyzicoRefundService } from '../../src/iyzico/iyzico-refund.service';
import { makeCTServicesMock, makeIyzicoMock, makePayment } from '../helpers/ct-client-mock';
import { stub } from '../helpers/stub';

type Interaction = Payment['interfaceInteractions'][number];

describe('IyzicoRefundService', () => {
  const refundAction = {
    action: 'refundPayment' as const,
    amount: { centAmount: 10000, currencyCode: 'TRY' },
    merchantReference: 'order-123-refund',
    transactionId: 'charge-1',
  };

  const itemTransactions = [
    {
      itemId: 'line-item-1',
      paidPrice: 40,
      paymentTransactionId: 'iyzi-tx-1',
      price: 40,
    },
    {
      itemId: 'line-item-2',
      paidPrice: 60,
      paymentTransactionId: 'iyzi-tx-2',
      price: 60,
    },
  ];

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const confirmInteraction = (extraFields: Record<string, string> = {}) =>
    stub<Interaction>({
      fields: {
        response: JSON.stringify({
          itemTransactions,
          paymentId: 'iyzi-payment-1',
        }),
        type: 'iyzico-confirm-success',
        ...extraFields,
      },
      type: { id: 'interaction-type', typeId: 'type' },
    });

  const recordedRefundInteraction = (originalPaymentTransactionId: string) =>
    stub<Interaction>({
      fields: {
        response: JSON.stringify({
          merchantReference: refundAction.merchantReference,
          originalPaymentTransactionId,
        }),
        type: 'iyzico-refund-success',
      },
      type: { id: 'interaction-type', typeId: 'type' },
    });

  const successfulCharge = (overrides: Record<string, string> = {}) =>
    ({
      amount: { centAmount: 10000, currencyCode: 'TRY' },
      id: 'charge-1',
      interfaceId: 'iyzi-payment-1',
      state: 'Success',
      type: 'Charge',
      ...overrides,
    }) as Payment['transactions'][number];

  function refundablePayment(overrides: Partial<Payment> = {}) {
    return makePayment({
      interfaceInteractions: [confirmInteraction()],
      transactions: [successfulCharge()],
      ...overrides,
    });
  }

  const resolveEveryRefundSuccessfully = (iyzico: ReturnType<typeof makeIyzicoMock>) => {
    iyzico.client.post.mockImplementation((_, requestValue) => {
      const request = requestValue as {
        conversationId: string;
        currency: string;
        paymentTransactionId: string;
        price: string;
      };
      return Promise.resolve({
        conversationId: request.conversationId,
        currency: request.currency,
        paymentId: 'iyzi-payment-1',
        paymentTransactionId: request.paymentTransactionId,
        price: Number(request.price),
        signature: 'valid-signature',
        status: 'success',
      });
    });
  };

  it('refunds every Iyzico item and records one successful CT Refund transaction', async () => {
    const ct = makeCTServicesMock();
    const iyzico = makeIyzicoMock();
    const payment = refundablePayment();
    ct.payment.getPayment.mockResolvedValue(payment);
    ct.payment.updatePayment.mockResolvedValue(payment);
    iyzico.client.post
      .mockResolvedValueOnce({
        conversationId: 'order-123-refund-line-item-1',
        currency: 'TRY',
        paymentId: 'iyzi-payment-1',
        paymentTransactionId: 'iyzi-tx-1',
        price: 40,
        signature: 'signature-1',
        status: 'success',
      })
      .mockResolvedValueOnce({
        conversationId: 'order-123-refund-line-item-2',
        currency: 'TRY',
        paymentId: 'iyzi-payment-1',
        paymentTransactionId: 'iyzi-tx-2',
        price: 60,
        signature: 'signature-2',
        status: 'success',
      });

    const service = new IyzicoRefundService(ct.payment, iyzico.client);
    const result = await service.refund(payment.id, refundAction);

    expect(result).toEqual({ outcome: PaymentModificationStatus.Approved });
    expect(iyzico.client.post.mock.calls[0]).toEqual([
      '/payment/refund',
      {
        conversationId: 'order-123-refund-line-item-1',
        currency: 'TRY',
        locale: 'tr',
        paymentTransactionId: 'iyzi-tx-1',
        price: '40',
      },
    ]);
    expect(iyzico.client.post.mock.calls[1]).toEqual([
      '/payment/refund',
      {
        conversationId: 'order-123-refund-line-item-2',
        currency: 'TRY',
        locale: 'tr',
        paymentTransactionId: 'iyzi-tx-2',
        price: '60',
      },
    ]);
    expect(ct.payment.updatePayment.mock.calls).toHaveLength(2);
    expect(ct.payment.updatePayment.mock.calls.at(-1)?.[0]).toMatchObject({
      id: payment.id,
      transaction: {
        amount: refundAction.amount,
        interactionId: refundAction.merchantReference,
        state: 'Success',
        type: 'Refund',
      },
    });
    expect(ct.payment.updatePayment.mock.calls.at(-1)?.[0].pspInteractions).toHaveLength(2);
  });

  it('records Failure and rejects the payment intent when Iyzico refuses an item refund', async () => {
    const ct = makeCTServicesMock();
    const iyzico = makeIyzicoMock();
    const payment = refundablePayment();
    ct.payment.getPayment.mockResolvedValue(payment);
    ct.payment.updatePayment.mockResolvedValue(payment);
    iyzico.client.post.mockResolvedValue({
      errorCode: '10012',
      errorMessage: 'Refund amount is invalid',
      retryable: false,
      status: 'failure',
    });

    const service = new IyzicoRefundService(ct.payment, iyzico.client);
    const result = await service.refund(payment.id, refundAction);

    expect(result).toEqual({ outcome: PaymentModificationStatus.Rejected });
    expect(iyzico.client.post.mock.calls).toHaveLength(2);
    expect(ct.payment.updatePayment.mock.calls).toHaveLength(2);
    expect(ct.payment.updatePayment.mock.calls.at(-1)?.[0]).toMatchObject({
      pspInteractions: [{ fields: { type: 'iyzico-refund-failure' } }, { fields: { type: 'iyzico-refund-failure' } }],
      transaction: {
        state: 'Failure',
        type: 'Refund',
      },
    });
  });

  it('logs refund progress without logging provider references or error messages', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const ct = makeCTServicesMock();
    const iyzico = makeIyzicoMock();
    const payment = refundablePayment();
    ct.payment.getPayment.mockResolvedValue(payment);
    ct.payment.updatePayment.mockResolvedValue(payment);
    iyzico.client.post.mockResolvedValue({
      errorCode: '10012',
      errorMessage: 'private provider details',
      retryable: false,
      status: 'failure',
    });

    const service = new IyzicoRefundService(ct.payment, iyzico.client);
    await service.refund(payment.id, refundAction);

    const logs = JSON.stringify([...log.mock.calls, ...error.mock.calls]);
    expect(logs).toContain('iyzico.refund.requested');
    expect(logs).toContain('iyzico.refund.item_failed');
    expect(logs).toContain(payment.id);
    expect(logs).not.toContain(refundAction.merchantReference);
    expect(logs).not.toContain('iyzi-tx-1');
    expect(logs).not.toContain('private provider details');
  });

  it('starts all Iyzico refunds without waiting for the previous item to finish', async () => {
    const ct = makeCTServicesMock();
    const iyzico = makeIyzicoMock();
    const payment = refundablePayment();
    ct.payment.getPayment.mockResolvedValue(payment);
    ct.payment.updatePayment.mockResolvedValue(payment);

    let resolveFirst!: (value: unknown) => void;
    let resolveSecond!: (value: unknown) => void;
    iyzico.client.post
      .mockReturnValueOnce(new Promise((resolve) => (resolveFirst = resolve)))
      .mockReturnValueOnce(new Promise((resolve) => (resolveSecond = resolve)));

    const service = new IyzicoRefundService(ct.payment, iyzico.client);
    const refund = service.refund(payment.id, refundAction);
    await Promise.resolve();
    await Promise.resolve();

    expect(iyzico.client.post).toHaveBeenCalledTimes(2);

    resolveFirst({
      conversationId: 'order-123-refund-line-item-1',
      currency: 'TRY',
      paymentId: 'iyzi-payment-1',
      paymentTransactionId: 'iyzi-tx-1',
      price: 40,
      signature: 'signature-1',
      status: 'success',
    });
    resolveSecond({
      conversationId: 'order-123-refund-line-item-2',
      currency: 'TRY',
      paymentId: 'iyzi-payment-1',
      paymentTransactionId: 'iyzi-tx-2',
      price: 60,
      signature: 'signature-2',
      status: 'success',
    });

    await expect(refund).resolves.toEqual({ outcome: PaymentModificationStatus.Approved });
  });

  it('records every settled result before propagating an Iyzico transport error', async () => {
    const ct = makeCTServicesMock();
    const iyzico = makeIyzicoMock();
    const payment = refundablePayment();
    ct.payment.getPayment.mockResolvedValue(payment);
    ct.payment.updatePayment.mockResolvedValue(payment);
    iyzico.client.post.mockRejectedValueOnce(new Error('socket hang up')).mockResolvedValueOnce({
      conversationId: 'order-123-refund-line-item-2',
      currency: 'TRY',
      paymentId: 'iyzi-payment-1',
      paymentTransactionId: 'iyzi-tx-2',
      price: 60,
      signature: 'signature-2',
      status: 'success',
    });

    const service = new IyzicoRefundService(ct.payment, iyzico.client);

    await expect(service.refund(payment.id, refundAction)).rejects.toThrow('socket hang up');
    expect(iyzico.client.post).toHaveBeenCalledTimes(2);
    expect(ct.payment.updatePayment.mock.calls.at(-1)?.[0]).toMatchObject({
      pspInteractions: [{ fields: { type: 'iyzico-refund-failure' } }, { fields: { type: 'iyzico-refund-success' } }],
      transaction: { state: 'Failure', type: 'Refund' },
    });
  });

  it('rejects partial refunds before calling Iyzico', async () => {
    const ct = makeCTServicesMock();
    const iyzico = makeIyzicoMock();
    const payment = refundablePayment();
    ct.payment.getPayment.mockResolvedValue(payment);

    const service = new IyzicoRefundService(ct.payment, iyzico.client);

    await expect(
      service.refund(payment.id, {
        ...refundAction,
        amount: { centAmount: 5000, currencyCode: 'TRY' },
      }),
    ).rejects.toThrow('Iyzico refunds currently support the full payment amount only');
    expect(iyzico.client.post.mock.calls).toHaveLength(0);
  });

  it('rejects payments whose Iyzico item transaction references were not stored', async () => {
    const ct = makeCTServicesMock();
    const iyzico = makeIyzicoMock();
    const payment = { ...refundablePayment(), interfaceInteractions: undefined as never };
    ct.payment.getPayment.mockResolvedValue(payment);

    const service = new IyzicoRefundService(ct.payment, iyzico.client);

    await expect(service.refund(payment.id, refundAction)).rejects.toBeInstanceOf(BadRequestException);
    expect(iyzico.client.post.mock.calls).toHaveLength(0);
  });

  it('returns approved without calling Iyzico when the same refund already succeeded', async () => {
    const ct = makeCTServicesMock();
    const iyzico = makeIyzicoMock();
    const payment = refundablePayment();
    payment.transactions.push({
      amount: refundAction.amount,
      id: 'refund-1',
      interactionId: refundAction.merchantReference,
      state: 'Success',
      type: 'Refund',
    } as never);
    ct.payment.getPayment.mockResolvedValue(payment);

    const service = new IyzicoRefundService(ct.payment, iyzico.client);
    const result = await service.refund(payment.id, refundAction);

    expect(result).toEqual({ outcome: PaymentModificationStatus.Approved });
    expect(iyzico.client.post.mock.calls).toHaveLength(0);
    expect(ct.payment.updatePayment.mock.calls).toHaveLength(0);
  });

  it('skips item refunds already recorded for the same merchant reference', async () => {
    const ct = makeCTServicesMock();
    const iyzico = makeIyzicoMock();
    const payment = refundablePayment({
      interfaceInteractions: [confirmInteraction(), recordedRefundInteraction('iyzi-tx-1')],
    });
    ct.payment.getPayment.mockResolvedValue(payment);
    ct.payment.updatePayment.mockResolvedValue(payment);
    iyzico.client.post.mockResolvedValue({
      conversationId: 'order-123-refund-line-item-2',
      currency: 'TRY',
      paymentId: 'iyzi-payment-1',
      paymentTransactionId: 'iyzi-tx-2',
      price: 60,
      signature: 'signature-2',
      status: 'success',
    });

    const service = new IyzicoRefundService(ct.payment, iyzico.client);
    const result = await service.refund(payment.id, refundAction);

    expect(result).toEqual({ outcome: PaymentModificationStatus.Approved });
    expect(iyzico.client.post.mock.calls).toHaveLength(1);
    expect(iyzico.client.post.mock.calls[0]).toEqual([
      '/payment/refund',
      expect.objectContaining({ paymentTransactionId: 'iyzi-tx-2' }),
    ]);
  });

  it('refunds the successful Charge selected by transactionId', async () => {
    const ct = makeCTServicesMock();
    const iyzico = makeIyzicoMock();
    const payment = refundablePayment({
      interfaceInteractions: [confirmInteraction({ interactionId: 'token-selected' })],
      transactions: [
        successfulCharge({ id: 'charge-other', interactionId: 'token-other' }),
        successfulCharge({ interactionId: 'token-selected' }),
      ],
    });
    ct.payment.getPayment.mockResolvedValue(payment);
    ct.payment.updatePayment.mockResolvedValue(payment);
    iyzico.client.post
      .mockResolvedValueOnce({
        conversationId: 'order-123-refund-line-item-1',
        currency: 'TRY',
        paymentId: 'iyzi-payment-1',
        paymentTransactionId: 'iyzi-tx-1',
        price: 40,
        signature: 'signature-1',
        status: 'success',
      })
      .mockResolvedValueOnce({
        conversationId: 'order-123-refund-line-item-2',
        currency: 'TRY',
        paymentId: 'iyzi-payment-1',
        paymentTransactionId: 'iyzi-tx-2',
        price: 60,
        signature: 'signature-2',
        status: 'success',
      });

    const service = new IyzicoRefundService(ct.payment, iyzico.client);
    await expect(service.refund(payment.id, refundAction)).resolves.toEqual({
      outcome: PaymentModificationStatus.Approved,
    });
  });

  it('rejects a successful Iyzico response that does not match the refund request', async () => {
    const ct = makeCTServicesMock();
    const iyzico = makeIyzicoMock();
    const payment = refundablePayment();
    ct.payment.getPayment.mockResolvedValue(payment);
    ct.payment.updatePayment.mockResolvedValue(payment);
    iyzico.client.post
      .mockResolvedValueOnce({
        conversationId: 'another-refund',
        currency: 'TRY',
        paymentId: 'iyzi-payment-1',
        paymentTransactionId: 'iyzi-tx-1',
        price: 40,
        signature: 'signature-1',
        status: 'success',
      })
      .mockResolvedValueOnce({
        conversationId: 'order-123-refund-line-item-2',
        currency: 'TRY',
        paymentId: 'iyzi-payment-1',
        paymentTransactionId: 'iyzi-tx-2',
        price: 60,
        signature: 'signature-2',
        status: 'success',
      });

    const service = new IyzicoRefundService(ct.payment, iyzico.client);

    await expect(service.refund(payment.id, refundAction)).rejects.toThrow(
      'Iyzico refund response does not match the request',
    );
    expect(ct.payment.updatePayment.mock.calls).toHaveLength(2);
    expect(ct.payment.updatePayment.mock.calls.at(-1)?.[0]).toMatchObject({
      pspInteractions: [{ fields: { type: 'iyzico-refund-failure' } }, { fields: { type: 'iyzico-refund-success' } }],
      transaction: { state: 'Failure', type: 'Refund' },
    });
  });

  it('rejects an Iyzico success response whose signature is invalid', async () => {
    const ct = makeCTServicesMock();
    const iyzico = makeIyzicoMock();
    const payment = refundablePayment();
    ct.payment.getPayment.mockResolvedValue(payment);
    ct.payment.updatePayment.mockResolvedValue(payment);
    iyzico.client.verifyResponseSignature.mockReturnValue(false);
    iyzico.client.post
      .mockResolvedValueOnce({
        conversationId: 'order-123-refund-line-item-1',
        currency: 'TRY',
        paymentId: 'iyzi-payment-1',
        paymentTransactionId: 'iyzi-tx-1',
        price: 40,
        signature: 'invalid-signature-1',
        status: 'success',
      })
      .mockResolvedValueOnce({
        conversationId: 'order-123-refund-line-item-2',
        currency: 'TRY',
        paymentId: 'iyzi-payment-1',
        paymentTransactionId: 'iyzi-tx-2',
        price: 60,
        signature: 'invalid-signature-2',
        status: 'success',
      });

    const service = new IyzicoRefundService(ct.payment, iyzico.client);

    await expect(service.refund(payment.id, refundAction)).rejects.toThrow(
      'Iyzico refund response has an invalid signature',
    );
    expect(ct.payment.updatePayment.mock.calls).toHaveLength(2);
    expect(ct.payment.updatePayment.mock.calls.at(-1)?.[0]).toMatchObject({
      pspInteractions: [{ fields: { type: 'iyzico-refund-failure' } }, { fields: { type: 'iyzico-refund-failure' } }],
      transaction: { state: 'Failure', type: 'Refund' },
    });
  });

  it('creates a stable refund reference when the caller does not provide one', async () => {
    const ct = makeCTServicesMock();
    const iyzico = makeIyzicoMock();
    const payment = refundablePayment();
    ct.payment.getPayment.mockResolvedValue(payment);
    ct.payment.updatePayment.mockResolvedValue(payment);
    resolveEveryRefundSuccessfully(iyzico);

    await new IyzicoRefundService(ct.payment, iyzico.client).refund(payment.id, {
      ...refundAction,
      merchantReference: undefined,
    });

    expect(iyzico.client.post).toHaveBeenCalledWith(
      '/payment/refund',
      expect.objectContaining({ conversationId: `refund-${payment.id}-10000-line-item-1` }),
    );
  });

  it('rejects a payment owned by another payment interface before creating a Refund transaction', async () => {
    const ct = makeCTServicesMock();
    const iyzico = makeIyzicoMock();
    const payment = refundablePayment({ paymentMethodInfo: { paymentInterface: 'adyen' } });
    ct.payment.getPayment.mockResolvedValue(payment);

    await expect(new IyzicoRefundService(ct.payment, iyzico.client).refund(payment.id, refundAction)).rejects.toThrow(
      `Payment ${payment.id} is not an Iyzico payment`,
    );
    expect(ct.payment.updatePayment).not.toHaveBeenCalled();
    expect(iyzico.client.post).not.toHaveBeenCalled();
  });

  it('rejects a transactionId that does not identify a successful Charge', async () => {
    const ct = makeCTServicesMock();
    const iyzico = makeIyzicoMock();
    const payment = refundablePayment();
    ct.payment.getPayment.mockResolvedValue(payment);

    await expect(
      new IyzicoRefundService(ct.payment, iyzico.client).refund(payment.id, {
        ...refundAction,
        transactionId: 'unknown-charge',
      }),
    ).rejects.toThrow(`Payment ${payment.id} has no successful Charge transaction unknown-charge`);
    expect(iyzico.client.post).not.toHaveBeenCalled();
  });

  it('uses the only successful Charge when the caller omits transactionId', async () => {
    const ct = makeCTServicesMock();
    const iyzico = makeIyzicoMock();
    const payment = refundablePayment();
    ct.payment.getPayment.mockResolvedValue(payment);
    ct.payment.updatePayment.mockResolvedValue(payment);
    resolveEveryRefundSuccessfully(iyzico);

    await expect(
      new IyzicoRefundService(ct.payment, iyzico.client).refund(payment.id, {
        ...refundAction,
        transactionId: undefined,
      }),
    ).resolves.toEqual({ outcome: PaymentModificationStatus.Approved });
  });

  it.each([
    ['no successful Charge', []],
    ['more than one successful Charge', [successfulCharge(), successfulCharge({ id: 'charge-2' })]],
  ])('requires transactionId when the payment has %s', async (_, transactions) => {
    const ct = makeCTServicesMock();
    const iyzico = makeIyzicoMock();
    const payment = refundablePayment({ transactions });
    ct.payment.getPayment.mockResolvedValue(payment);

    await expect(
      new IyzicoRefundService(ct.payment, iyzico.client).refund(payment.id, {
        ...refundAction,
        transactionId: undefined,
      }),
    ).rejects.toThrow(`Payment ${payment.id} must have exactly one successful Charge when transactionId is omitted`);
    expect(iyzico.client.post).not.toHaveBeenCalled();
  });

  it('rejects a second successful refund even when it uses another merchant reference', async () => {
    const ct = makeCTServicesMock();
    const iyzico = makeIyzicoMock();
    const payment = refundablePayment({
      transactions: [
        successfulCharge(),
        {
          amount: refundAction.amount,
          id: 'completed-refund',
          interactionId: 'another-refund-reference',
          state: 'Success',
          type: 'Refund',
        } as never,
      ],
    });
    ct.payment.getPayment.mockResolvedValue(payment);

    await expect(new IyzicoRefundService(ct.payment, iyzico.client).refund(payment.id, refundAction)).rejects.toThrow(
      `Payment ${payment.id} is already refunded`,
    );
    expect(iyzico.client.post).not.toHaveBeenCalled();
  });

  it('skips unrelated and malformed interactions before using the matching payment result', async () => {
    const ct = makeCTServicesMock();
    const iyzico = makeIyzicoMock();
    const payment = refundablePayment({
      interfaceInteractions: [
        confirmInteraction({ interactionId: 'selected-token' }),
        confirmInteraction({ interactionId: 'another-token' }),
        confirmInteraction({ interactionId: 'selected-token', response: '{not-json' }),
      ],
      transactions: [successfulCharge({ interactionId: 'selected-token' })],
    });
    ct.payment.getPayment.mockResolvedValue(payment);
    ct.payment.updatePayment.mockResolvedValue(payment);
    resolveEveryRefundSuccessfully(iyzico);

    await expect(new IyzicoRefundService(ct.payment, iyzico.client).refund(payment.id, refundAction)).resolves.toEqual(
      {
        outcome: PaymentModificationStatus.Approved,
      },
    );
  });

  it('uses item transactions recorded by a successful recurring payment', async () => {
    const ct = makeCTServicesMock();
    const iyzico = makeIyzicoMock();
    const payment = refundablePayment({
      interfaceInteractions: [confirmInteraction({ type: 'iyzico-refill-success' })],
    });
    ct.payment.getPayment.mockResolvedValue(payment);
    ct.payment.updatePayment.mockResolvedValue(payment);
    resolveEveryRefundSuccessfully(iyzico);

    await expect(new IyzicoRefundService(ct.payment, iyzico.client).refund(payment.id, refundAction)).resolves.toEqual(
      {
        outcome: PaymentModificationStatus.Approved,
      },
    );
  });

  it('records a failed Refund before rejecting an invalid Iyzico response', async () => {
    const ct = makeCTServicesMock();
    const iyzico = makeIyzicoMock();
    const payment = refundablePayment();
    ct.payment.getPayment.mockResolvedValue(payment);
    ct.payment.updatePayment.mockResolvedValue(payment);
    iyzico.client.post.mockResolvedValue({ status: 'success' });

    await expect(new IyzicoRefundService(ct.payment, iyzico.client).refund(payment.id, refundAction)).rejects.toThrow(
      'Iyzico returned an invalid refund response',
    );
    expect(ct.payment.updatePayment.mock.calls.at(-1)?.[0]).toMatchObject({
      transaction: { state: 'Failure', type: 'Refund' },
    });
  });

  it('turns a non-Error transport rejection into a safe connector failure', async () => {
    const ct = makeCTServicesMock();
    const iyzico = makeIyzicoMock();
    const payment = refundablePayment();
    ct.payment.getPayment.mockResolvedValue(payment);
    ct.payment.updatePayment.mockResolvedValue(payment);
    iyzico.client.post.mockRejectedValue('private transport detail');

    await expect(new IyzicoRefundService(ct.payment, iyzico.client).refund(payment.id, refundAction)).rejects.toThrow(
      'Iyzico refund request failed',
    );
    expect(ct.payment.updatePayment.mock.calls.at(-1)?.[0].pspInteractions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fields: expect.objectContaining({ response: expect.stringContaining('Unknown connector error') }),
        }),
      ]),
    );
  });

  it('uses the original item transaction identifier when a failed response provides no replacement', async () => {
    const ct = makeCTServicesMock();
    const iyzico = makeIyzicoMock();
    const payment = refundablePayment();
    ct.payment.getPayment.mockResolvedValue(payment);
    ct.payment.updatePayment.mockResolvedValue(payment);
    iyzico.client.post.mockResolvedValue({ status: 'failure' });

    await new IyzicoRefundService(ct.payment, iyzico.client).refund(payment.id, refundAction);

    const interactions = ct.payment.updatePayment.mock.calls.at(-1)?.[0].pspInteractions ?? [];
    expect(interactions[0].fields).toMatchObject({
      interactionId: 'iyzi-tx-1',
      type: 'iyzico-refund-failure',
    });
  });

  it('continues past a matching interaction whose JSON has the wrong shape', async () => {
    const ct = makeCTServicesMock();
    const iyzico = makeIyzicoMock();
    const payment = refundablePayment({
      interfaceInteractions: [confirmInteraction(), confirmInteraction({ response: JSON.stringify({}) })],
    });
    ct.payment.getPayment.mockResolvedValue(payment);
    ct.payment.updatePayment.mockResolvedValue(payment);
    resolveEveryRefundSuccessfully(iyzico);

    await expect(new IyzicoRefundService(ct.payment, iyzico.client).refund(payment.id, refundAction)).resolves.toEqual(
      {
        outcome: PaymentModificationStatus.Approved,
      },
    );
  });

  it('does not treat an item recorded for another refund reference as already refunded', async () => {
    const ct = makeCTServicesMock();
    const iyzico = makeIyzicoMock();
    const interaction = recordedRefundInteraction('iyzi-tx-1');
    interaction.fields.response = JSON.stringify({
      merchantReference: 'another-refund-reference',
      originalPaymentTransactionId: 'iyzi-tx-1',
    });
    const payment = refundablePayment({ interfaceInteractions: [confirmInteraction(), interaction] });
    ct.payment.getPayment.mockResolvedValue(payment);
    ct.payment.updatePayment.mockResolvedValue(payment);
    resolveEveryRefundSuccessfully(iyzico);

    await new IyzicoRefundService(ct.payment, iyzico.client).refund(payment.id, refundAction);

    expect(iyzico.client.post).toHaveBeenCalledTimes(2);
  });

  it('ignores an interaction without an Iyzico type before using an older valid result', async () => {
    const ct = makeCTServicesMock();
    const iyzico = makeIyzicoMock();
    const payment = refundablePayment({
      interfaceInteractions: [confirmInteraction(), stub<Interaction>({ fields: undefined })],
    });
    ct.payment.getPayment.mockResolvedValue(payment);
    ct.payment.updatePayment.mockResolvedValue(payment);
    resolveEveryRefundSuccessfully(iyzico);

    await expect(new IyzicoRefundService(ct.payment, iyzico.client).refund(payment.id, refundAction)).resolves.toEqual(
      {
        outcome: PaymentModificationStatus.Approved,
      },
    );
  });
});
