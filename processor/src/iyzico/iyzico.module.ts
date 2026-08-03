import { Module } from '@nestjs/common';
import { IyzicoSignatureService } from './iyzico-signature.service';
import { CommercetoolsModule } from '../commercetools/commercetools.module';
import { IyzicoClient } from './iyzico.client';
import { IyzicoPaymentController } from './iyzico-payment.controller';
import { IyzicoCardService } from './iyzico-card.service';
import { IyzicoPaymentService } from './iyzico-payment.service';
import { IyzicoRecurringService } from './iyzico-recurring.service';

@Module({
  imports: [CommercetoolsModule],
  controllers: [IyzicoPaymentController],
  providers: [IyzicoSignatureService, IyzicoClient, IyzicoCardService, IyzicoPaymentService, IyzicoRecurringService],
  exports: [
    IyzicoRecurringService,
  ],
})
export class IyzicoModule { }
