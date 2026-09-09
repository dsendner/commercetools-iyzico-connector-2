import { z } from 'zod';

import {
  IyzicoItemTransaction,
  iyzicoItemTransactionsSchema,
} from './item-transaction.schema';
import { iyzicoIdentifierSchema } from './primitives.schema';

export const storedIyzicoPaymentInteractionSchema = z.looseObject({
  itemTransactions: iyzicoItemTransactionsSchema.min(1),
  paymentId: iyzicoIdentifierSchema.optional(),
});

export const storedIyzicoRefundInteractionSchema = z.looseObject({
  merchantReference: z.string().min(1),
  originalPaymentTransactionId: iyzicoIdentifierSchema,
});

export function toStoredItemTransactions(
  items: IyzicoItemTransaction[] | undefined,
): IyzicoItemTransaction[] {
  return iyzicoItemTransactionsSchema
    .parse(items ?? [])
    .map(({ itemId, paidPrice, paymentTransactionId, price }) => ({
      itemId,
      paidPrice,
      paymentTransactionId,
      price,
    }));
}
