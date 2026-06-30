export const IYZICO_CALLBACK_PATH = '/iyzico/payments/callback';


export function buildCallbackUrl(baseUrl: string, paymentReference: string, ctSessionId?: string, merchantReturnUrl?: string): string {
    const url = new URL(IYZICO_CALLBACK_PATH, baseUrl);
    url.searchParams.set('paymentReference', paymentReference);
    if(ctSessionId){
        url.searchParams.set('sessionId', ctSessionId);
    }
    if(merchantReturnUrl){
        url.searchParams.set('returnUrl', merchantReturnUrl);
    }
    return url.toString();
}