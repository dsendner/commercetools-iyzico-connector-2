import { Money } from "@commercetools/connect-payments-sdk";
import { centAmountToIyzicoPrice } from "./iyzico-cart.mapper";

export interface IyzicoRefundRequest {
    locale: string;
    conversationId: string;
    paymentId: string;
    price: string;
    currency: string;
}

export interface IyzicoCancelRequest {
    locale: string;
    conversationId: string;
    paymentId: string;
}

export interface IyzicoRefundResponse {
    status: 'success' | 'failure';
    locale?: string;
    systemTime?: number;
    conversationId?: string;
    paymentId?: string;
    price?: number;
    currency?: string;
    authCode?: string;
    hostReference?: string;
    refundHostReference?: string;
    cancelHostReference?: string;
    retryable?: boolean;
    errorCode?: string;
    errorMessage?: string;
    errorGroup?: string;
}

type Amount = Money & { fractionDigits?: number };

export function toIyzicoRefundRequest(
    paymentId: string,
    amount: Amount,
    conversationId: string,
    locale: string,
): IyzicoRefundRequest {
    return {
        locale,
        conversationId,
        paymentId,
        price: centAmountToIyzicoPrice(amount.centAmount, amount.fractionDigits ?? 2),
        currency: amount.currencyCode,
    };
}

export function toIyzicoCancelRequest(
    paymentId: string,
    conversationId: string,
    locale: string,
): IyzicoCancelRequest {
    return {
        locale,
        conversationId,
        paymentId,
    };
}

const IYZICO_TIME_ZONE = 'Europe/Istanbul';

function toIyzicoDay(date: Date): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: IYZICO_TIME_ZONE }).format(date);
}

export function isSameIyzicoDay(first: Date, second: Date): boolean {
    return toIyzicoDay(first) === toIyzicoDay(second);
}
