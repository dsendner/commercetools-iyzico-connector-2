import { z } from 'zod';

import { iyzicoDecimalSchema, iyzicoIdentifierSchema } from './primitives.schema';

const iyzicoConvertedPayoutSchema = z.looseObject({
  blockageRateAmountMerchant: iyzicoDecimalSchema.optional(),
  blockageRateAmountSubMerchant: iyzicoDecimalSchema.optional(),
  currency: z.string().optional(),
  iyziCommissionFee: iyzicoDecimalSchema.optional(),
  iyziCommissionRateAmount: iyzicoDecimalSchema.optional(),
  iyziConversionRate: iyzicoDecimalSchema.optional(),
  iyziConversionRateAmount: iyzicoDecimalSchema.optional(),
  merchantPayoutAmount: iyzicoDecimalSchema.optional(),
  paidPrice: iyzicoDecimalSchema.optional(),
  subMerchantPayoutAmount: iyzicoDecimalSchema.optional(),
});

export const iyzicoItemTransactionSchema = z.looseObject({
  blockageRate: iyzicoDecimalSchema.optional(),
  blockageRateAmountMerchant: iyzicoDecimalSchema.optional(),
  blockageRateAmountSubMerchant: iyzicoDecimalSchema.optional(),
  blockageResolvedDate: z.string().optional(),
  convertedPayout: iyzicoConvertedPayoutSchema.optional(),
  itemId: iyzicoIdentifierSchema,
  iyziCommissionFee: iyzicoDecimalSchema.optional(),
  iyziCommissionRateAmount: iyzicoDecimalSchema.optional(),
  merchantCommissionRate: iyzicoDecimalSchema.optional(),
  merchantCommissionRateAmount: iyzicoDecimalSchema.optional(),
  merchantPayoutAmount: iyzicoDecimalSchema.optional(),
  paidPrice: iyzicoDecimalSchema.pipe(z.number().positive()),
  paymentTransactionId: iyzicoIdentifierSchema,
  price: iyzicoDecimalSchema.pipe(z.number().positive()),
  subMerchantPayoutAmount: iyzicoDecimalSchema.optional(),
  subMerchantPayoutRate: iyzicoDecimalSchema.optional(),
  subMerchantPrice: iyzicoDecimalSchema.optional(),
  transactionStatus: z.number().int().optional(),
});

export const iyzicoItemTransactionsSchema = z.array(iyzicoItemTransactionSchema);

export type IyzicoItemTransaction = z.infer<typeof iyzicoItemTransactionSchema>;
