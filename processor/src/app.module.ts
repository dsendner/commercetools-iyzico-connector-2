import { MiddlewareConsumer, Module } from '@nestjs/common';
import { IyzicoModule } from './iyzico/iyzico.module';
import { CommercetoolsModule } from './commercetools/commercetools.module';
import { RequestContextMiddleware } from './commercetools/request-context.middleware';
import { ConfigModule } from '@nestjs/config';
import { OperationsModule } from './operations/operations.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      envFilePath: '.env.local',
      isGlobal: true,
    }),
    IyzicoModule,
    CommercetoolsModule,
    ConfigModule,
    OperationsModule,
  ]
})
export class AppModule {

  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
