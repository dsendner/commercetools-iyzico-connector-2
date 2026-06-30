import { MiddlewareConsumer, Module } from '@nestjs/common';
import { IyzicoModule } from './iyzico/iyzico.module';
import { CommercetoolsModule } from './commercetools/commercetools.module';
import { RequestContextMiddleware } from './commercetools/request-context.middleware';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [
    ConfigModule.forRoot({
      envFilePath: '.env.local',
      isGlobal: true,
    }),
    IyzicoModule,
    CommercetoolsModule,
    ConfigModule,
  ]
})
export class AppModule {

  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
