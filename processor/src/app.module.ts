import { MiddlewareConsumer, Module } from '@nestjs/common';
import { IyzicoModule } from './iyzico/iyzico.module';
import { CommercetoolsModule } from './commercetools/commercetools.module';
import { RequestContextMiddleware } from './commercetools/request-context.middleware';
import { OperationsModule } from './operations/operations.module';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { ConfigModule } from './config/config.module';
import { DevModule } from './dev/dev.modules';

const isProduction = process.env.NODE_ENV === 'production';

@Module({
  imports: [
    NestConfigModule.forRoot({
      envFilePath: '.env.local',
      isGlobal: true,
    }),
    IyzicoModule,
    CommercetoolsModule,
    ConfigModule,
    OperationsModule,
      ...(isProduction ? [] : [DevModule]),
  ]
})
export class AppModule {

  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
