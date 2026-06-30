import {CheckoutFormInitResponse, PaymentEnablerOptions } from './payment-enabler';

export class IyzicoPaymentEnabler {
    constructor(private options: PaymentEnablerOptions) {}

    public async initCheckoutForm(): Promise<CheckoutFormInitResponse> {
      const response = await fetch(`${this.options.processorUrl}/iyzico/sessions`, {
          method: 'POST',
          headers: {
              'Content-Type': 'application/json',
              'X-Session-Id': this.options.sessionId
          }
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
         throw new Error(body.message ?? `Processor error: HTTP ${response.status}`)
      }

      return response.json();
    }
}

export * from './payment-enabler';