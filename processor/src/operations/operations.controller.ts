import { Body, Controller, Get, HttpCode, NotImplementedException, Param, Post, UseGuards } from '@nestjs/common';
import type { TransactionDraft, TransactionResponse } from './transaction.dto';
import { StatusResponseSchemaDTO } from './status.dto';
import { JwtAuthGuard } from '../commercetools/jwt-auth.guard';
import { IyzicoRecurringService } from '../iyzico/iyzico-recurring.service';

@Controller('operations')
export class OperationsController {

    constructor(private readonly iyzicoRecurringService: IyzicoRecurringService) { }

    @Get('status')
    //@UseGuards(JwtAuthGuard)
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

    // CT Checkout contract stub, Iyzico is direct charge only
    @Post('payment-intents/:id')
    @HttpCode(200)
    async modifyPayment(@Param('id') id: string) {
        throw new NotImplementedException('Not supported by Iyzico connector');
    }

    @Get('payment-components')
    //@UseGuards(JwtAuthGuard)
    async paymentComponents() {
        return {
            dropins: [{ type: 'embedded' }],
            components: [],
            express: [],
        };
    }

    @Post('transactions')
    @HttpCode(201)
    async createTransaction(@Body() body: TransactionDraft): Promise<TransactionResponse> {
      return this.iyzicoRecurringService.handleTransaction(body);
    }
}

