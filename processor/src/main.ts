import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const port = Number(process.env.PORT);

    app.enableCors({
    origin: process.env.NODE_ENV === 'production'
      ? process.env.ALLOWED_ORIGINS?.split(',').map(s => s.trim())
      : true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-Session-Id', 'Authorization'],
    credentials: true,
  });

  await app.listen(port, '0.0.0.0');

  console.log(`Processor listening on ${port}`);
}

bootstrap();
