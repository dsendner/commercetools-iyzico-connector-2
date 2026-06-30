import { IyzicoPaymentResult } from "./iyzico-retrieve-payment.converter";

export interface SavedCard {
    cardToken: string;
    cardUserKey: string;
    brand?: string;
    lastFourDigits?: string;
    bin?: string;
    expiryMonth?: number;
    expiryYear?: number;
}

export interface IyzicoStoreCard {
    cardToken: string;
    expireMonth?: string;
    expireYear?: string;
}

export interface IyzicoCardListResponse {
    status: 'success' | 'failure';
    cardDetails?: IyzicoStoreCard[];
}

export interface CardExpiry {
    month: number;
    year: number;
}

export function toSavedCard(paymentResult: any): SavedCard | undefined {
    if (!paymentResult.cardToken || !paymentResult.cardUserKey) return undefined;
    
    return {
        cardToken: paymentResult.cardToken,
        cardUserKey: paymentResult.cardUserKey,
        brand: paymentResult.cardBrand || paymentResult.cardAssociation,
        lastFourDigits: paymentResult.lastFourDigits,
        bin: paymentResult.binNumber,
        expiryMonth: paymentResult.expiryMonth,
        expiryYear: paymentResult.expiryYear
    };
}
export function packCardToken(cardUserKey: string, cardToken: string): string {
   return `${cardUserKey}::${cardToken}`;
}

export function findExpiry(list: IyzicoCardListResponse, cardToken: string): CardExpiry | undefined {
    const card = list.cardDetails?.find(c => c.cardToken === cardToken);
    const month = Number(card?.expireMonth);
    const year = Number(card?.expireYear);
    return month && year ? { month, year } : undefined;
}