import { Body, Controller, Get, HttpCode, NotImplementedException, Param, Post } from '@nestjs/common';
import type { TransactionDraft, TransactionResponse } from './transaction.dto';
import { StatusResponse } from './status.dto';

@Controller('operations')
export class OperationsController {

    constructor() { }

    @Get('status')
    // TODO: restore @UseGuards(JwtAuthGuard) before CT Checkout integration
    async status(): Promise<StatusResponse> {
        return {
            metadata: {
                name: 'iyzico-payment-connector',
                description: 'Iyzico payment connector for commercetools',
                version: process.env.npm_package_version ?? '0.0.1',
            },
            status: 'OK',
            timestamp: new Date().toISOString(),
        };
    }

    // CT Checkout contract stub, Iyzico is direct charge only
    @Post('payment-intents/:id')
    @HttpCode(200)
    async modifyPayment(@Param('id') id: string) {
        throw new NotImplementedException('Not supported by Iyzico connector');
    }

    @Get('payment-components')
    async paymentComponents() {
        return {
            dropins: [{ type: 'embedded' }],
            components: [],
        };
    }

    @Post('transactions')
    @HttpCode(201)
    async createTransaction(@Body() body: TransactionDraft): Promise<TransactionResponse> {
        // TODO: implement
        throw new NotImplementedException('handleTransaction not yet implemented');
    }
}

