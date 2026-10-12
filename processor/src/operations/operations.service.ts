import { BadRequestException, Injectable } from '@nestjs/common';
import { IyzicoRefundService } from '../iyzico/iyzico-refund.service';
import { PaymentIntentRequest, PaymentIntentResponse, readRefundAction } from './payment-intent.dto';

@Injectable()
export class OperationsService {
    constructor(private readonly refundService: IyzicoRefundService) { }

    async modifyPayment(paymentId: string, body: PaymentIntentRequest): Promise<PaymentIntentResponse> {
        let action;
        try {
            action = readRefundAction(body);
        } catch (error) {
            throw new BadRequestException((error as Error).message);
        }

        const outcome = await this.refundService.refundPayment(paymentId, {
            amount: action.amount,
            merchantReference: action.merchantReference,
        });

        return { outcome };
    }
}
