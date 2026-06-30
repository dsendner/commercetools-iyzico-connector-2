export interface IyzicoWebhookPayload {
    iyziEventType: string;
    iyziPaymentId: number | string;
    token: string;
    paymentConversationId: string; // our CT paymentId
    status: string;
    iyziReferenceCode?: string;
    iyziEventTime?: number;
    merchantId?: string;
}