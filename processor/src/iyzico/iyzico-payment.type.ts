export interface HandlCallbackResponse {
    redirectUrl?: string;
}

export interface PaymentResponse {
    paymentReference: string; //CT payment Id
    paymentStatus: 'Success' | 'Failure' | 'Pending';
    errorCode?: string;
    errorMessage?: string;
}