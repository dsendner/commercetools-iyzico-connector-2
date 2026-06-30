import { Controller, Get } from '@nestjs/common';
import { IyzicoTestService } from './iyzico/iyzico-test.service';

@Controller()
export class AppController {
  constructor(private readonly iyzicoTestService: IyzicoTestService) {}

  @Get('health')
  getHealth() {
    return {
      status: 'ok',
      service: 'iyzico-connector-processor',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('ping')
  async ping() {
    console.log('Received ping request, calling IyzicoTestService...');
    return await this.iyzicoTestService.pingSandbox();
  }
}
