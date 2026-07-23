export interface EnablerOptions {
  processorUrl: string;
  sessionId: string;
  locale?: string;
  onComplete?: (result: PaymentResult) => void;
  onError?: (error: Error) => void;
}

export interface PaymentResult {
  isSuccess: boolean;
  paymentReference: string;
}

export type DropinType = 'embedded' | 'hpp';

export interface PaymentDropinBuilder {
  dropinHasSubmit: boolean;
  build(): PaymentDropinComponent;
}

export interface PaymentDropinComponent {
  mount(selector: string): Promise<void>;
  submit(): Promise<void>;
  unmount(): Promise<void>;
}

export interface PaymentEnabler {
  createDropinBuilder(type: DropinType): Promise<PaymentDropinBuilder>;
  createComponentBuilder(type: string): Promise<never>;
}

export interface CheckoutFormInitResponse {
  paymentReference: string;
  checkoutFormContent: string;
  paymentPageUrl: string;
}