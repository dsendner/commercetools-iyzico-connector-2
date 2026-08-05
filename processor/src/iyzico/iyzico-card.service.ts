import { Inject, Injectable, Logger } from "@nestjs/common";
import { IyzicoClient } from "./iyzico.client";
import { findExpiry, IyzicoCardListResponse, packCardToken, packSession, SavedCard, SavedSession, unpackCardToken } from "./converters/iyzico-card-storage.converter";
import { PaymentMethod, type CommercetoolsPaymentMethodService } from "@commercetools/connect-payments-sdk";
import { CT_PAYMENT_METHOD_SERVICE } from "../commercetools/tokens";

@Injectable()
export class IyzicoCardService {
    private readonly logger = new Logger(IyzicoCardService.name);

    constructor(
        private readonly iyzico: IyzicoClient,
        @Inject(CT_PAYMENT_METHOD_SERVICE) private readonly ctPaymentMethods: CommercetoolsPaymentMethodService,
    ) { }

    async saveCard(customerId: string, card: SavedCard): Promise<PaymentMethod> {
        const expiry = await this.fetchExpiry(card.cardUserKey, card.cardToken);

        const brand = card.brand || (card as any).cardAssociation || 'card';
        const lastFourDigits = card.lastFourDigits || (card as any).lastFourDigits;
        const bin = card.bin || (card as any).binNumber;

        const paymentMethod = await this.ctPaymentMethods.save({
            customerId,
            paymentInterface: 'iyzico',
            method: brand,
            token: packCardToken(card.cardUserKey, card.cardToken),
            customFields: {
                type: { key: 'commercetools-checkout-card-details', typeId: 'type' },
                fields: {
                    brand,
                    lastFour: lastFourDigits,
                    bin,
                    expiryMonth: expiry?.month ? Number(expiry.month) : undefined,
                    expiryYear: expiry?.year ? Number(expiry.year) : undefined,
                    storePaymentMethod: true,
                },
            },
        });

        this.logger.log(`Saved card for customer ${customerId}`);
        return paymentMethod;
    }

    async saveSession(customerId: string, session: SavedSession): Promise<PaymentMethod> {
    return this.ctPaymentMethods.save({
        customerId,
        paymentInterface: 'iyzico',
        method: session.brand || 'PWI',
        token: packSession(session.sessionToken, session.memberIdentifier),
        customFields: {
            type: { key: 'commercetools-checkout-card-details', typeId: 'type' },
            fields: {
                brand: session.brand,
                lastFour: session.lastFourDigits,
                bin: session.bin,
                storePaymentMethod: true,
            },
        },
    });
}

    async getUserKey(customerId?: string): Promise<string | undefined> {
    if (!customerId) return undefined;

    const { results } = await this.ctPaymentMethods.find({
        customerId,
        paymentInterface: 'iyzico',
    });

    const cardMethod = results.find(pm => pm.token?.value?.startsWith('CARD::'));
    if (!cardMethod?.token?.value) return undefined;

    return unpackCardToken(cardMethod.token.value).cardUserKey;
}

    private async fetchExpiry(cardUserKey: string, cardToken: string) {
        const cards = await this.iyzico.post<IyzicoCardListResponse>('/cardstorage/cards', {
            locale: 'tr',
            cardUserKey,
        });
        return findExpiry(cards, cardToken);
    }
}