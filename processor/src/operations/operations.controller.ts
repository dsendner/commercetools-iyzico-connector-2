import { BadRequestException, Body, Controller, Get, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { TransactionDraft, TransactionResponse } from './transaction.dto';
import { StatusResponseSchemaDTO } from './status.dto';
import { PaymentIntentResponse, paymentIntentRequestSchema } from './payment-intents.dto';
import { IyzicoRefundService } from '../iyzico/iyzico-refund.service';
import { IyzicoRecurringService } from '../iyzico/iyzico-recurring.service';
import { JwtAuthGuard } from '../commercetools/guards/jwt-auth.guard';
import { OAuth2AuthGuard } from '../commercetools/guards/oauth2-auth.guard';
import { AuthorityAuthGuard, RequiredScopes } from '../commercetools/guards/authority-auth.guard';
import { CartActiveGuard, RequireCart } from '../commercetools/guards/cart-active.guard';
import { Cart } from '@commercetools/connect-payments-sdk';

type AuthedRequest = Request & {
    cartId: string;
    cart: Cart;
};

@Controller('operations')
export class OperationsController {

    constructor(
        private readonly iyzicoRecurringService: IyzicoRecurringService,
        private readonly iyzicoRefundService: IyzicoRefundService,
    ) { }

    @Get('status')
    @UseGuards(JwtAuthGuard)
    async status(): Promise<StatusResponseSchemaDTO> {
        return {
            status: 'OK',
            timestamp: new Date().toISOString(),
            version: process.env.npm_package_version ?? '1.0.0',
            metadata: {
                name: 'iyzico-payment-connector',
                description: 'Iyzico payment connector for commercetools',
            },
            checks: [
                { name: 'Iyzico API', status: 'UP' },
            ],
        };
    }

    // Iyzico is a direct charge, so refundPayment is the only supported action
    @Post('payment-intents/:id')
    @HttpCode(200)
    @UseGuards(OAuth2AuthGuard, AuthorityAuthGuard)
    @RequiredScopes('manage_project', 'manage_checkout_payment_intents')
    async modifyPayment(@Param('id') id: string, @Body() body: unknown): Promise<PaymentIntentResponse> {
        const parsed = paymentIntentRequestSchema.safeParse(body);
        if (!parsed.success) {
            throw new BadRequestException('A single refundPayment action with a valid amount is required');
        }

        return this.iyzicoRefundService.refund(id, parsed.data.actions[0]);
    }

    @Get('payment-components')
    @UseGuards(JwtAuthGuard)
    async paymentComponents() {
        return {
            dropins: [{ type: 'embedded' }],
            components: [],
            express: [],
        };
    }

    @Post('transactions')
    @HttpCode(201)
    @UseGuards(OAuth2AuthGuard, AuthorityAuthGuard, CartActiveGuard)
    @RequiredScopes('manage_project', 'manage_checkout_transactions')
    @RequireCart('active-with-customer')
    async createTransaction(@Body() body: TransactionDraft, @Req() request: AuthedRequest): Promise<TransactionResponse> {
        return this.iyzicoRecurringService.handleTransaction(body, request.cart);
    }
}

