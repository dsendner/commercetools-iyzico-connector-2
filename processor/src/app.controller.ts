import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
  constructor() {}

  @Get('health')
  getHealth() {
    return {
      status: 'ok',
      service: 'iyzico-connector-processor',
      timestamp: new Date().toISOString(),
    };
  }
}
