import { iyzicoItemTransactionSchema } from '../../../src/iyzico/contracts/item-transaction.schema';
import { iyzicoRefundResponseSchema } from '../../../src/iyzico/contracts/refund.schema';

describe('Iyzico transaction schemas', () => {
  it('parses the documented successful refund response', () => {
    const result = iyzicoRefundResponseSchema.parse({
      conversationId: 'refund-123-item-1',
      currency: 'TRY',
      locale: 'tr',
      paymentId: '20885695',
      paymentTransactionId: '24080880',
      price: 40,
      signature: 'documented-response-signature',
      status: 'success',
      systemTime: 1_698_048_416_625,
    });

    expect(result).toMatchObject({
      paymentTransactionId: '24080880',
      price: 40,
      status: 'success',
    });
  });

  it('normalizes numeric identifiers and decimal strings returned by Iyzico', () => {
    const result = iyzicoItemTransactionSchema.parse({
      itemId: 101,
      paidPrice: '40.00',
      paymentTransactionId: 24_080_880,
      price: '4E1',
    });

    expect(result).toMatchObject({
      itemId: '101',
      paidPrice: 40,
      paymentTransactionId: '24080880',
      price: 40,
    });
  });

  it('rejects a successful refund response missing fields required for reconciliation', () => {
    const result = iyzicoRefundResponseSchema.safeParse({ status: 'success' });

    expect(result.success).toBe(false);
  });
});

describe.each([
  {
    fields: ['authCode', 'hostReference', 'refundHostReference'],
    name: 'successful refund',
    response: {
      conversationId: 'refund-123-item-1',
      currency: 'TRY',
      paymentId: '20885695',
      paymentTransactionId: '24080880',
      price: 40,
      signature: 'documented-response-signature',
      status: 'success',
    },
    schema: iyzicoRefundResponseSchema,
  },
  {
    fields: ['authCode', 'hostReference', 'refundHostReference'],
    name: 'failed refund',
    response: { status: 'failure' },
    schema: iyzicoRefundResponseSchema,
  },
])('Optional response fields for a $name', ({ fields, response, schema }) => {
  it('accepts the response when optional fields are absent', () => {
    expect(schema.safeParse(response).success).toBe(true);
  });

  it.each(fields)(
    'preserves %s as a string without modifying its value',
    (field) => {
      const value = '  reference-with-leading-and-trailing-spaces  ';
      const result = schema.parse({ ...response, [field]: value });

      expect(result).toHaveProperty(field, value);
    },
  );

  it.each(fields)(
    'rejects non-string values for %s instead of accepting them as unknown fields',
    (field) => {
      for (const value of [123, false, null, {}, []]) {
        const result = schema.safeParse({ ...response, [field]: value });

        expect(result.success).toBe(false);
        expect(result.error?.issues).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ code: 'invalid_type', path: [field] }),
          ]),
        );
      }
    },
  );
});
