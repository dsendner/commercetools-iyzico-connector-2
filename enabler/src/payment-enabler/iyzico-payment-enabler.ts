import {
  PaymentEnabler,
  EnablerOptions,
  PaymentDropinBuilder,
  PaymentDropinComponent,
  DropinType,
  CheckoutFormInitResponse,
} from './payment-enabler';

export class IyzicoPaymentEnabler implements PaymentEnabler {
  constructor(private readonly options: EnablerOptions) {
    if (!options.processorUrl) throw new Error('processorUrl is required');
    if (!options.sessionId) throw new Error('sessionId is required');
  }

  async createDropinBuilder(type: DropinType): Promise<PaymentDropinBuilder> {
    if (type !== 'embedded') {
      throw new Error(`Dropin type "${type}" not supported — only "embedded"`);
    }
    return new IyzicoDropinBuilder(this.options);
  }

  async createComponentBuilder(_type: string): Promise<never> {
    throw new Error('Components not supported — use the embedded dropin');
  }
}

class IyzicoDropinBuilder implements PaymentDropinBuilder {
  public dropinHasSubmit = false;

  constructor(private readonly options: EnablerOptions) {}

  build(): PaymentDropinComponent {
    return new IyzicoDropin(this.options);
  }
}

class IyzicoDropin implements PaymentDropinComponent {
  private container: HTMLElement | null = null;

  constructor(private readonly options: EnablerOptions) {}

  async mount(selector: string): Promise<void> {
    this.container = document.querySelector(selector);
    if (!this.container) {
      throw new Error(`IyzicoDropin: no element found for selector "${selector}"`);
    }

    try {
      const { checkoutFormContent } = await this.initSession();
      this.injectCheckoutForm(checkoutFormContent);
    } catch (err) {
      this.options.onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  }

  async submit(): Promise<void> {
    // Iyzico checkout form has its own pay button — nothing to do
  }

  async unmount(): Promise<void> {
    if (this.container) {
      this.container.innerHTML = '';
      this.container = null;
    }
  }

  private async initSession(): Promise<CheckoutFormInitResponse> {
    const response = await fetch(`${this.options.processorUrl}/iyzico/session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Id': this.options.sessionId,
      },
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.message ?? `Processor error: HTTP ${response.status}`);
    }

    return response.json();
  }

  private injectCheckoutForm(checkoutFormContent: string): void {
    if (!this.container) return;

    this.container.innerHTML = checkoutFormContent;

    const scripts = this.container.querySelectorAll('script');

    if (scripts.length === 0) {
      console.error("Error while rendering Iyzico checkout form - no content found!");
      return;
    }

    setTimeout(() => {
      scripts.forEach((oldScript) => {
        const newScript = document.createElement('script');

        Array.from(oldScript.attributes).forEach((attr) =>
          newScript.setAttribute(attr.name, attr.value),
        );
        
        newScript.text = oldScript.textContent || oldScript.text || '';
        
        document.body.appendChild(newScript);
      });
    }, 100);
  }
}