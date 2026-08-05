import { Module } from '@nestjs/common';
import { OperationsController } from './operations.controller';
import { OperationsService } from './operations.service';
import { IyzicoModule } from '../iyzico/iyzico.module';

@Module({
  controllers: [OperationsController],
  providers: [OperationsService],
  imports: [IyzicoModule],
})
export class OperationsModule {}
