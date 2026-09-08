import { z } from 'zod';

import { iyzicoItemTransactionsSchema } from './item-transaction.schema';
import { iyzicoDecimalSchema, iyzicoErrorCodeSchema, iyzicoIdentifierSchema } from './primitives.schema';

const decimalSchema = iyzicoDecimalSchema.pipe(z.number().nonnegative());

const paymentFailureSchema = z.looseObject({
  conversationId: z.string().optional(),
  errorCode: iyzicoErrorCodeSchema.optional(),
  errorMessage: z.string().optional(),
  status: z.literal('failure'),
});

const paymentSuccessSchema = z.looseObject({
  basketId: z.string().min(1),
  conversationId: z.string().min(1),
  currency: z.enum(['CHF', 'EUR', 'GBP', 'NOK', 'TRY', 'USD']),
  fraudStatus: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
  itemTransactions: iyzicoItemTransactionsSchema.min(1),
  paidPrice: decimalSchema,
  paymentId: iyzicoIdentifierSchema,
  price: decimalSchema,
  signature: z.string().min(1),
  status: z.literal('success'),
});

const createdPaymentSuccessSchema = paymentSuccessSchema.extend({ paymentStatus: z.null().optional() });
const retrievedPaymentSuccessSchema = paymentSuccessSchema.extend({
  paymentStatus: z.enum(['CALLBACK_THREEDS', 'FAILURE', 'INIT_THREEDS', 'SUCCESS']),
});

export const iyzicoCreatedPaymentResponseSchema = z.discriminatedUnion('status', [
  paymentFailureSchema,
  createdPaymentSuccessSchema,
]);

export const iyzicoPaymentDetailResponseSchema = z.discriminatedUnion('status', [
  paymentFailureSchema,
  retrievedPaymentSuccessSchema,
]);

const reportingRefundSchema = z.looseObject({
  currencyCode: z.enum(['CHF', 'EUR', 'GBP', 'NOK', 'TRY', 'USD']),
  refundConversationId: z.string().min(1),
  refundPrice: decimalSchema,
  refundStatus: z.number().int(),
});

const reportingItemTransactionSchema = z.looseObject({
  paymentTransactionId: iyzicoIdentifierSchema,
  refunds: z.array(reportingRefundSchema),
});

const reportingPaymentSchema = z.looseObject({
  currency: z.enum(['CHF', 'EUR', 'GBP', 'NOK', 'TRY', 'USD']),
  itemTransactions: z.array(reportingItemTransactionSchema).min(1),
  paidPrice: decimalSchema,
  paymentId: iyzicoIdentifierSchema,
  paymentRefundStatus: z.string().min(1),
  price: decimalSchema,
});

const reportingFailureSchema = z.looseObject({
  errorCode: iyzicoErrorCodeSchema.optional(),
  errorMessage: z.string().optional(),
  status: z.literal('failure'),
});

const reportingSuccessSchema = z.looseObject({
  conversationId: z.string().optional(),
  payments: z.array(reportingPaymentSchema).min(1),
  status: z.literal('success'),
});

export const iyzicoPaymentReportResponseSchema = z.discriminatedUnion('status', [
  reportingFailureSchema,
  reportingSuccessSchema,
]);

export type IyzicoCreatedPayment = z.infer<typeof createdPaymentSuccessSchema>;
export type IyzicoPaymentReport = z.infer<typeof reportingSuccessSchema>;
export type IyzicoRetrievedPayment = z.infer<typeof retrievedPaymentSuccessSchema>;
