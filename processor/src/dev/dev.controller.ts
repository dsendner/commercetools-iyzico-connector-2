import { Controller, Get, Query, Logger } from '@nestjs/common';

@Controller('dev')
export class DevController {
  private readonly logger = new Logger(DevController.name);

  /**
   * Landing page for the Iyzico return URL in local development.
   * Set DEFAULT_RETURN_URL=http://localhost:3000/dev/payment-result
   */
  @Get('payment-result')
  paymentResult(@Query() query: Record<string, string>) {
    this.logger.log(`Payment result callback: ${JSON.stringify(query)}`);
    return {
      message: 'Payment flow completed',
      params: query,
      receivedAt: new Date().toISOString(),
    };
  }
}