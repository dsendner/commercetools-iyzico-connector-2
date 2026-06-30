export type IyzicoPaymentStatus =
    | 'SUCCESS'
    | 'FAILURE'
    | 'INIT_THREEDS'
    | 'CALLBACK_THREEDS'
    | 'BANK_FAIL'
    | 'PENDING_CREDIT';



// Response of POST /payment/iyzipos/checkoutform/auth/ecom/detail

export interface IyzicoRetrieveResponse {
    status: 'Success' | 'Failure';          // API-call level
    errorCode?: string;
    errorMessage?: string;
    locale?: string;
    systemTime?: number;
    conversationId: string;                 // our CT payment id
    paymentId?: string;                     // Iyzico's payment id (present on success)
    paymentStatus?: IyzicoPaymentStatus;
    fraudStatus?: number;                   // 1 approved, 0 in review, -1 rejected
    price?: number | string;
    paidPrice?: number | string;
    currency?: string;
    installment?: number;
    basketId?: string;
    token?: string;
    signature?: string;                     // hex HMAC for integrity verification
    cardAssociation?: string;               // VISA | MASTER_CARD | AMERICAN_EXPRESS | TROY
    cardType?: string;                      // CREDIT_CARD | DEBIT_CARD | PREPAID_CARD
    lastFourDigits?: string;
    cardToken?: string;
    cardUserKey?: string;
    binNumber?: string;
}


export interface IyzicoPaymentResult {
    paymentStatus: 'Success' | 'Failure' | 'Pending';
    iyzicoPaymentId?: string;
    cardBrand?: string;   // normalized card brand, set the CT payment method
    cardToken?: string;
    cardUserKey?: string;
    cardAssociation?: string;               // VISA | MASTER_CARD | AMERICAN_EXPRESS | TROY
    cardType?: string;                      // CREDIT_CARD | DEBIT_CARD | PREPAID_CARD
    lastFourDigits?: string;
    binNumber?: string;
    errorCode?: string;
    errorMessage?: string;
    isFraud?: boolean;
    fraudStatus?: number;
    expiryMonth?: number;
    expiryYear?: number;
}

const CARD_BRANDS: Record<string, string> = {
    VISA: 'VISA',
    MASTER_CARD: 'MASTER_CARD',
    AMERICAN_EXPRESS: 'AMERICAN_EXPRESS',
    TROY: 'TROY',
};

function toCardBrand(cardAssociation?: string): string {
    if (!cardAssociation) return "card";
    return CARD_BRANDS[cardAssociation] ?? cardAssociation.toUpperCase();
}

export function toIyzicoPaymentResult(res: IyzicoRetrieveResponse): IyzicoPaymentResult {
    const base = {
        iyzicoPaymentId: res.paymentId,
        cardAssociation: res.cardAssociation,
        cardBrand: toCardBrand(res.cardAssociation),
        cardToken: res.cardToken,
        cardUserKey: res.cardUserKey,
        binNumber: res.binNumber,
        lastFourDigits: res.lastFourDigits,
        errorCode: res.errorCode,
        errorMessage: res.errorMessage,
        fraudStatus: res.fraudStatus,
    };

    if (res.status === 'Failure' || res.paymentStatus === 'FAILURE' || res.paymentStatus === 'BANK_FAIL') {
        return { 
            ...base,
            paymentStatus: 'Failure',
            isFraud: res.fraudStatus === -1,
        };
    }

    if (res.paymentStatus === 'SUCCESS') {
        // fraudStatus -1 = rejected
        if (res.fraudStatus === -1) {
            return { ...base, paymentStatus: 'Failure', isFraud: true };
        }
        // fraudStatus 0 = under review, 1 = approved (Both considered 'success' status at this phase)
        return { ...base, paymentStatus: 'Success', isFraud: false };
    }

    // INIT_THREEDS / CALLBACK_THREEDS / PENDING_CREDIT → not final yet
    return { ...base, paymentStatus: 'Pending' };
}

export function handleIyzicoError(paymentResult: IyzicoPaymentResult): {errorCode?: string; errorMessage?: string} {
    if(paymentResult.paymentStatus !== 'Failure') return {};
    
    if(paymentResult.isFraud) {
        return {
            errorCode: "GENERIC_ERROR",
            errorMessage: "Payment could not be completed",
        };
    }
    return {
        errorCode: paymentResult.errorCode,
        errorMessage: paymentResult.errorMessage,
    };
}