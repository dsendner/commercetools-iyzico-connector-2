import type { Cart, Payment, PaymentMethod } from '@commercetools/platform-sdk';
import * as connectSdk from '@commercetools/connect-payments-sdk'; // 1. Import the SDK namespace
import { IyzicoPaymentService } from '../../src/iyzico/iyzico-payment.service';
import { IyzicoClient } from '../../src/iyzico/iyzico.client';
import { IyzicoCardService } from '../../src/iyzico/iyzico-card.service';

export const money = (centAmount: number) => ({
    type: 'centPrecision' as const,
    centAmount,
    currencyCode: 'TRY',
    fractionDigits: 2,
});

export function makeCart(): Cart {
    return {
        id: 'cart-1',
        locale: 'tr-TR',
        customerId: 'cust-1',
        customerEmail: 'john@example.com',
        totalPrice: money(4990),
        billingAddress: { firstName: 'John', lastName: 'Doe', city: 'Istanbul', country: 'TR', streetName: 'Nidakule' },
        shippingAddress: { firstName: 'John', lastName: 'Doe', city: 'Istanbul', country: 'TR' },
        lineItems: [{ id: 'li-1', name: { tr: 'Tişört' }, quantity: 1, totalPrice: money(4990) }],
    } as unknown as Cart;
}

export const payment = { id: 'pay-1', amountPlanned: money(4990), interfaceId: 'tok-xyz' } as Payment;
export const sessionRequest = { cartId: 'cart-1', clientIp: '1.2.3.4' };
export const paymentMethods = {};

export function makeCt(
  overrides: { carts?: object; payments?: object; paymentMethods?: object } = {},
) {
  const mockProcessorUrl = 'https://processor.example';
  const mockSessionId = 'sess-1';
  const mockReturnUrl = 'https://shop.example/return';

  return {
    carts: {
      getCart: jest.fn().mockResolvedValue(makeCart()),
      getCartByPaymentId: jest.fn().mockResolvedValue(makeCart()),
      addPayment: jest.fn().mockResolvedValue(makeCart()),
      ...overrides.carts,
    },
    payments: {
      createPayment: jest.fn().mockResolvedValue(payment),
      updatePayment: jest.fn().mockResolvedValue(payment),
      findPaymentsByInterfaceId: jest.fn().mockResolvedValue([payment]),
      getPayment: jest.fn().mockResolvedValue(payment),
      ...overrides.payments,
    },
    paymentMethods: {
      find: jest.fn(),
      save: jest.fn(),
      delete: jest.fn(),
      get: jest.fn(),
      ...overrides.paymentMethods,
    },
    // Retain these for backward compatibility with other assertions if needed
    getProcessorUrl: jest.fn().mockReturnValue(mockProcessorUrl),
    getSessionId: jest.fn().mockReturnValue(mockSessionId),
    getMerchantReturnUrl: jest.fn().mockReturnValue(mockReturnUrl),
    interactionDraft: jest.fn((input: unknown) => ({ fields: input })),
    cardDetailsDraft: jest.fn((input: unknown) => ({ fields: input })),
  };
}

export const createMockPaymentMethodService = (overrides = {}) => {
    return {
        get: jest.fn().mockResolvedValue({
            id: 'pm-1',
            method: 'MASTER_CARD',
            token: { value: 'user-key-1::card-tok-1' }
        }),
        findPaymentsByInterfaceId: jest.fn().mockResolvedValue([]),
        updatePayment: jest.fn().mockResolvedValue({ id: 'pay-1', version: 2 }),
        ...overrides,
    };
};

export const makeCardService = (ct: ReturnType<typeof makeCt>, client: IyzicoClient) =>
  new IyzicoCardService(client, ct.paymentMethods as never);

export const makePaymentService = (ct: ReturnType<typeof makeCt>, client: IyzicoClient) =>
  new IyzicoPaymentService(ct.carts as never, ct.payments as never, client, makeCardService(ct, client));


