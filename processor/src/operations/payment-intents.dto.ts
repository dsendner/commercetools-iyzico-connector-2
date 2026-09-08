import { z } from 'zod';

const amountSchema = z.object({
  centAmount: z.number().int().positive(),
  currencyCode: z.string().regex(/^[A-Z]{3}$/),
});

const refundPaymentActionSchema = z.object({
  action: z.literal('refundPayment'),
  amount: amountSchema,
  merchantReference: z.string().min(1).optional(),
  transactionId: z.string().min(1).optional(),
});

export const paymentIntentRequestSchema = z.object({
  actions: z.array(refundPaymentActionSchema).length(1),
});

export type RefundPaymentAction = z.infer<typeof refundPaymentActionSchema>;
export type PaymentIntentRequest = z.infer<typeof paymentIntentRequestSchema>;

export enum PaymentModificationStatus {
  Approved = 'approved',
  Received = 'received',
  Rejected = 'rejected',
}

export interface PaymentIntentResponse {
  outcome: PaymentModificationStatus;
}
