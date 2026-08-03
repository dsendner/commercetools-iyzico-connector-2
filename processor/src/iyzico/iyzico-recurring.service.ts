import { BadRequestException, Inject, Injectable, Logger } from "@nestjs/common";
import * as connectPaymentsSdk from '@commercetools/connect-payments-sdk';
import { IyzicoCardService } from "./iyzico-card.service";
import { IyzicoClient } from "./iyzico.client";
import { TransactionDraft, TransactionResponse } from "src/operations/transaction.dto";
import { CT_CART_SERVICE, CT_PAYMENT_SERVICE, CT_PAYMENT_METHOD_SERVICE } from "src/commercetools/tokens";

@Injectable()
export class IyzicoRecurringService {
    private readonly logger = new Logger(IyzicoRecurringService.name);

    constructor(
        private readonly iyzico: IyzicoClient,
        private readonly iyzicoCardService: IyzicoCardService,
        @Inject(CT_CART_SERVICE) private readonly ctCart: connectPaymentsSdk.CommercetoolsCartService,
        @Inject(CT_PAYMENT_SERVICE) private readonly ctPayment: connectPaymentsSdk.CommercetoolsPaymentService,
        @Inject(CT_PAYMENT_METHOD_SERVICE) private readonly ctPaymentMethods: connectPaymentsSdk.CommercetoolsPaymentMethodService,
    ) { }

    async handleTransaction(draft: TransactionDraft): Promise<TransactionResponse> {
        const cart = await this.ctCart.getCart({ id: draft.cart.id });

        if (!cart.customerId) {
            throw new BadRequestException('Recurring payment requires an authenticated customer');
        }
        return {
            id: 'transaction-id',
            version: 1,
            key: draft.key,
            transactionStatus: {
                state: 'Initial',
            },
        };
    }
}