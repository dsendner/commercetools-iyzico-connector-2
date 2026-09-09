import { z } from 'zod';

import {
  iyzicoDecimalSchema,
  iyzicoIdentifierSchema,
} from './primitives.schema';

export interface IyzicoRefundRequest {
  conversationId: string;
  currency: string;
  locale: string;
  paymentTransactionId: string;
  price: string;
}

const iyzicoRefundFailureResponseSchema = z.looseObject({
  authCode: z.string().optional(),
  conversationId: z.string().optional(),
  errorCode: z.string().optional(),
  errorMessage: z.string().optional(),
  hostReference: z.string().optional(),
  locale: z.enum(['en', 'tr']).optional(),
  paymentId: iyzicoIdentifierSchema.optional(),
  paymentTransactionId: iyzicoIdentifierSchema.optional(),
  price: iyzicoDecimalSchema.optional(),
  refundHostReference: z.string().optional(),
  retryable: z.boolean().optional(),
  status: z.literal('failure'),
  systemTime: z.number().int().positive().optional(),
});

const iyzicoRefundSuccessResponseSchema = z.looseObject({
  authCode: z.string().optional(),
  conversationId: z.string().min(1),
  currency: z.string().regex(/^[A-Z]{3}$/),
  hostReference: z.string().optional(),
  locale: z.enum(['en', 'tr']).optional(),
  paymentId: iyzicoIdentifierSchema,
  paymentTransactionId: iyzicoIdentifierSchema,
  price: iyzicoDecimalSchema.pipe(z.number().positive()),
  refundHostReference: z.string().optional(),
  retryable: z.boolean().optional(),
  signature: z.string().min(1),
  status: z.literal('success'),
  systemTime: z.number().int().positive().optional(),
});

export const iyzicoRefundResponseSchema = z.discriminatedUnion('status', [
  iyzicoRefundFailureResponseSchema,
  iyzicoRefundSuccessResponseSchema,
]);

export type IyzicoRefundResponse = z.infer<typeof iyzicoRefundResponseSchema>;
