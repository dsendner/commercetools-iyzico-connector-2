import { storedIyzicoPaymentInteractionSchema } from '../../src/operations/iyzico-interaction.schema';

describe('storedIyzicoPaymentInteractionSchema', () => {
  it('rejects stored payment interactions without refundable item references', () => {
    const result = storedIyzicoPaymentInteractionSchema.safeParse({ itemTransactions: [] });

    expect(result.success).toBe(false);
  });
});
