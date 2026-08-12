export type PaymentOutcome = 'Success' | 'Failure' | 'Pending';

export type IyzicoPaymentStatus =
    | 'SUCCESS'
    | 'FAILURE'
    | 'INIT_THREEDS'
    | 'CALLBACK_THREEDS'
    | 'BANK_FAIL'
    | 'PENDING_CREDIT';

export type FraudDecision = 'approved' | 'review' | 'rejected';

export interface IyzicoRetrieveResponse {
    status: 'Success' | 'Failure';
    conversationId: string;
    paymentStatus?: IyzicoPaymentStatus;
    fraudStatus?: number;
    paymentId?: string;
    errorCode?: string;
    errorMessage?: string;
    cardAssociation?: string;
    cardType?: string;
    cardFamily?: string;
    lastFourDigits?: string;
    cardToken?: string;
    cardUserKey?: string;
    binNumber?: string;
    pwiPayment?: boolean;
    memberEmail?: string;
    memberGsmNumber?: string;
    price?: number | string;
    paidPrice?: number | string;
    currency?: string;
    installment?: number;
    sessionInfo?: {
        sessionToken: string;
        sessionStatus: 'ACTIVE' | 'PASSIVE';
        memberIdentifier?: string;
        paymentType?: 'CARD_PAYMENT' | 'FUND';
    };
}

export interface IyzicoPaymentResult {
    outcome: PaymentOutcome;
    fraudDecision: FraudDecision;
    isFraud: boolean;
    rawPaymentStatus?: IyzicoPaymentStatus;
    rawFraudStatus?: number;
    iyzicoPaymentId?: string;
    cardBrand?: string;
    cardAssociation?: string;
    cardType?: string;
    cardFamily?: string;
    cardToken?: string;
    cardUserKey?: string;
    lastFourDigits?: string;
    binNumber?: string;
    errorCode?: string;
    errorMessage?: string;
    installment?: number;
    conversationId?: string;
}

const CARD_BRANDS = new Set(['VISA', 'MASTER_CARD', 'AMERICAN_EXPRESS', 'TROY']);

const FAILURE_STATUSES: ReadonlySet<IyzicoPaymentStatus> = new Set(['FAILURE', 'BANK_FAIL']);
const PENDING_STATUSES: ReadonlySet<IyzicoPaymentStatus> = new Set(['INIT_THREEDS', 'CALLBACK_THREEDS', 'PENDING_CREDIT']);

function toCardBrand(cardAssociation?: string): string | undefined {
    if (!cardAssociation) return undefined;
    const upper = cardAssociation.toUpperCase();
    return CARD_BRANDS.has(upper) ? upper : upper;
}

function toFraudDecision(fraudStatus?: number): FraudDecision {
    if (fraudStatus === -1) return 'rejected';
    if (fraudStatus === 0)  return 'review';
    return 'approved';
}

function resolveOutcome(res: IyzicoRetrieveResponse, fraud: FraudDecision): PaymentOutcome {
    if (res.status === 'Failure') return 'Failure';
    if (fraud === 'rejected') return 'Failure';

    const status = res.paymentStatus;
    if (!status) return 'Failure';

    if (FAILURE_STATUSES.has(status)) return 'Failure';
    if (PENDING_STATUSES.has(status)) return 'Pending';
    if (status === 'SUCCESS') return 'Success';

    return 'Failure'; 
}

export function toIyzicoPaymentResult(res: IyzicoRetrieveResponse): IyzicoPaymentResult {
    const fraudDecision = toFraudDecision(res.fraudStatus);
    const outcome = resolveOutcome(res, fraudDecision);
    return {
        outcome,
        fraudDecision,
        isFraud: fraudDecision === 'rejected',
        rawPaymentStatus: res.paymentStatus,
        rawFraudStatus: res.fraudStatus,
        iyzicoPaymentId: res.paymentId,
        cardBrand: toCardBrand(res.cardAssociation),
        cardAssociation: res.cardAssociation,
        cardType: res.cardType,
        cardFamily: res.cardFamily,
        cardToken: res.cardToken,
        cardUserKey: res.cardUserKey,
        lastFourDigits: res.lastFourDigits,
        binNumber: res.binNumber,
        errorCode: res.errorCode,
        errorMessage: res.errorMessage,
        installment: res.installment,
        conversationId: res.conversationId,
    };
}