export interface PaymentEnablerOptions {
    processorUrl: string;
    sessionId: string;
}

export interface CheckoutFormInitResponse {
    paymentReference: string;
    checkoutFormContent: string;
    paymentPageUrl: string;
}
