import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './commons/global-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const port = Number(process.env.PORT);

  app.useGlobalFilters(new GlobalExceptionFilter());

    app.enableCors({
    origin: process.env.NODE_ENV === 'production'
      ? process.env.ALLOWED_ORIGINS?.split(',').map(s => s.trim())
      : true,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Correlation-ID', 'X-Request-ID', 'X-Session-ID'],
    methods: ['GET', 'HEAD', 'POST', 'DELETE'],
    credentials: true,
  });

  await app.listen(port, '0.0.0.0');

  console.log(`Processor listening on ${port}`);
}

bootstrap();
