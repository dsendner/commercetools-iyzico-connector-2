import { Module } from '@nestjs/common';
import { IyzicoSignatureService } from './iyzico-signature.service';
import { IyzicoTestService } from './iyzico-test.service';
import { CommercetoolsModule } from '../commercetools/commercetools.module';
import { IyzicoClient } from './iyzico.client';

@Module({
  imports: [CommercetoolsModule],
  providers: [IyzicoSignatureService, IyzicoTestService, IyzicoClient],
  exports: [
    IyzicoTestService,
  ],
})
export class IyzicoModule {}
