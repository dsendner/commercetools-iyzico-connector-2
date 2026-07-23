import { Module } from '@nestjs/common';
import { IyzicoSignatureService } from './iyzico-signature.service';
import { IyzicoTestService } from './iyzico-test.service';
import { CommercetoolsModule } from '../commercetools/commercetools.module';
import { IyzicoClient } from './iyzico.client';
import { IyzicoPaymentController } from './iyzico-payment.controller';
import { IyzicoCardService } from './iyzico-card.service';
import { IyzicoPaymentService } from './iyzico-payment.service';

@Module({
  imports: [CommercetoolsModule],
  controllers: [IyzicoPaymentController],
  providers: [IyzicoSignatureService, IyzicoTestService, IyzicoClient, IyzicoCardService, IyzicoPaymentService],
  exports: [
    IyzicoTestService,
  ],
})
export class IyzicoModule { }
