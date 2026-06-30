import { Inject, Injectable, Logger } from "@nestjs/common";
import { IyzicoClient } from "./iyzico.client";
import { findExpiry, IyzicoCardListResponse, packCardToken, SavedCard } from "./converters/iyzico-card-storage.converter";
import { GenerateCardDetailsCustomFieldsDraft, type CommercetoolsPaymentMethodService } from "@commercetools/connect-payments-sdk";
import { CT_PAYMENT_METHOD_SERVICE } from "../../src/commercetools/commercetools.module";

@Injectable()
export class IyzicoCardService {
    private readonly logger = new Logger(IyzicoCardService.name);

    constructor(
        private readonly iyzico: IyzicoClient,
        @Inject(CT_PAYMENT_METHOD_SERVICE) private readonly ctPaymentMethods: CommercetoolsPaymentMethodService,
    ) { }

    async save(customerId: string, card: SavedCard): Promise<void> {
        const expiry = await this.fetchExpiry(card.cardUserKey, card.cardToken);

        const brand = card.brand || (card as any).cardAssociation || 'card';
        const lastFourDigits = card.lastFourDigits || (card as any).lastFourDigits;
        const bin = card.bin || (card as any).binNumber;

        const saveOptions: any = {
            customerId,
            paymentInterface: "iyzico",
            method: brand,
            token: packCardToken(card.cardUserKey, card.cardToken),
            customFields: {
                type: {
                    key: "commercetools-checkout-card-details",
                    typeId: "type"
                },
                fields: {
                    brand: brand,
                    lastFour: lastFourDigits,
                    bin: bin,
                    expiryMonth: expiry?.month ? Number(expiry.month) : undefined,
                    expiryYear: expiry?.year ? Number(expiry.year) : undefined,
                    storePaymentMethod: true
                }
            },
        }

        await this.ctPaymentMethods.save(saveOptions);
        this.logger.log(`Saved card for customer ${customerId}`);
    }

    async getUserKey(customerId?: string): Promise<string | undefined> {
        if (!customerId) {
            return undefined;
        }
        try {
            const existingMethods: any = await this.ctPaymentMethods.find({
                customerId,
                paymentInterface: 'iyzico'
            });

            if (existingMethods?.results && existingMethods.results.length > 0) {
                const firstMethod = existingMethods.results[0];
                const tokenValue = firstMethod.token?.value || firstMethod.token;

                if (tokenValue && typeof tokenValue === 'string') {
                    const [cardUserKey] = tokenValue.split('::');
                    return cardUserKey;
                }
            }
        } catch (error) {
            this.logger.error(`Failed to fetch cardUserKey for customer ${customerId}: ${error.message}`);
        }

        return undefined;
    }

    private async fetchExpiry(cardUserKey: string, cardToken: string) {
        const cards = await this.iyzico.post<IyzicoCardListResponse>('/cardstorage/cards', {
            locale: 'tr',
            cardUserKey,
        });
        return findExpiry(cards, cardToken);
    }
}

