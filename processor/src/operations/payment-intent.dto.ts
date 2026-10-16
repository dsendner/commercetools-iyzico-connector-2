export const REFUND_APPROVED = 'approved';
export const REFUND_REJECTED = 'rejected';

export type RefundOutcome = typeof REFUND_APPROVED | typeof REFUND_REJECTED;

export interface PaymentIntentAmount {
    centAmount: number;
    currencyCode: string;
}

export interface RefundPaymentAction {
    action: 'refundPayment';
    amount: PaymentIntentAmount;
    merchantReference?: string;
}

export interface OtherPaymentAction {
    action: 'capturePayment' | 'cancelPayment' | 'reversePayment';
}

export type PaymentIntentAction = RefundPaymentAction | OtherPaymentAction;

export interface PaymentIntentRequest {
    actions: PaymentIntentAction[];
}

export interface PaymentIntentResponse {
    outcome: RefundOutcome;
}

export function readRefundAction(body: PaymentIntentRequest | undefined): RefundPaymentAction {
    const action = body?.actions?.[0];

    if (!action) {
        throw new Error('A payment intent needs exactly one action');
    }

    if (action.action !== 'refundPayment') {
        throw new Error(`Payment modification "${action.action}" is not supported by the Iyzico connector`);
    }

    const amount = (action as RefundPaymentAction).amount;
    if (!Number.isInteger(amount?.centAmount) || amount.centAmount <= 0 || !/^[A-Z]{3}$/.test(amount?.currencyCode ?? '')) {
        throw new Error('A refund needs a positive centAmount and a three letter currency code');
    }

    return action as RefundPaymentAction;
}
