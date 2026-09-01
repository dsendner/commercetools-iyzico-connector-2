import { InternalServerErrorException } from '@nestjs/common';
import { buildTestClient } from './helpers/test-client';
import {
  makeCTServicesMock,
  makePaymentService,
  sessionRequest,
} from './helpers/ct-client-mock';
import { mapBasketItems } from '../src/iyzico/converters/iyzico-cart.mapper';

jest.mock('@commercetools/connect-payments-sdk', () => {
  const actual = jest.requireActual('@commercetools/connect-payments-sdk');
  return {
    ...actual,
    getProcessorUrlFromContext: jest.fn().mockReturnValue('https://processor.example'),
    getCtSessionIdFromContext: jest.fn().mockReturnValue('sess-1'),
    getMerchantReturnUrlFromContext: jest.fn().mockReturnValue('https://shop.example/return'),
    getFutureOrderNumberFromContext: jest.fn().mockReturnValue(undefined),
  };
});

describe('IyzicoPaymentService.createSession (service + converter + client)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('reads the cart, creates a payment, calls Iyzico, stores the token, returns the reference', async () => {
    const initResponse = {
      status: 'Success',
      conversationId: 'pay-1',
      token: 'tok-xyz',
      checkoutFormContent: '<script>iyzicoForm</script>',
      paymentPageUrl: 'https://sandbox-cpp.iyzipay.com/?token=tok-xyz',
    };
    const { client, captured } = buildTestClient([initResponse]);

    const ct = makeCTServicesMock();
    ct.cart.getCart.mockResolvedValue(sessionRequest.cart);
    ct.payment.createPayment.mockResolvedValue({ id: 'pay-1', version: 1 } as any);
    ct.payment.updatePayment.mockResolvedValue({ id: 'pay-1', version: 2 } as any);
    ct.cart.addPayment.mockResolvedValue(sessionRequest.cart);

    const service = makePaymentService(ct, client);

    const result = await service.createSession(sessionRequest);

    expect(ct.payment.createPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        amountPlanned: { centAmount: 4990, currencyCode: 'TRY' },
        paymentMethodInfo: { paymentInterface: 'iyzico' },
      }),
    );

    expect(captured[0].url).toBe('/payment/iyzipos/checkoutform/initialize/auth/ecom');
    const sent = JSON.parse(captured[0].data as string);
    expect(sent.conversationId).toBe('pay-1');
    expect(sent.basketId).toBe('cart-1');
    expect(sent.price).toBe('49.90');

    const callbackUrl = new URL(sent.callbackUrl);
    expect(callbackUrl.origin + callbackUrl.pathname).toBe(
      'https://processor.example/iyzico/payments/callback',
    );
    expect(callbackUrl.searchParams.get('paymentReference')).toBe('pay-1');
    expect(callbackUrl.searchParams.get('sessionId')).toBe('sess-1');
    expect(callbackUrl.searchParams.get('returnUrl')).toBe('https://shop.example/return');
    expect(sent.buyer.ip).toBe('1.2.3.4');

    expect(ct.payment.updatePayment).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'pay-1',
        pspReference: 'tok-xyz',
        transaction: expect.objectContaining({
          type: 'Charge',
          state: 'Initial',
          interactionId: 'tok-xyz',
        }),
      }),
    );

    expect(result).toEqual({
      paymentReference: 'pay-1',
      checkoutFormContent: '<script>iyzicoForm</script>',
      paymentPageUrl: 'https://sandbox-cpp.iyzipay.com/?token=tok-xyz',
    });

    const stored = JSON.parse(
      (ct.payment.updatePayment.mock.calls[0][0] as any).pspInteractions[0].fields.response,
    );
    expect(stored).toMatchObject({
      paymentPageUrl: 'https://sandbox-cpp.iyzipay.com/?token=tok-xyz',
    });

    expect(ct.cart.addPayment).toHaveBeenCalledWith(
      expect.objectContaining({ paymentId: 'pay-1' }),
    );
  });

  it('throws 500 and does NOT store a token when Iyzico rejects the init', async () => {
    const { client } = buildTestClient([
      {
        status: 'Failure',
        errorCode: '50001',
        errorMessage: 'Request message is not readable',
        conversationId: 'pay-1',
      },
    ]);

    const ct = makeCTServicesMock();
    ct.cart.getCart.mockResolvedValue(sessionRequest.cart);
    ct.payment.createPayment.mockResolvedValue({ id: 'pay-1', version: 1 } as any);

    const service = makePaymentService(ct, client);

    await expect(service.createSession(sessionRequest)).rejects.toThrow(
      /Could not start the checkout init payment/,
    );
    expect(ct.payment.updatePayment).not.toHaveBeenCalled();
  });

  it('sends price (sum of items) and paidPrice (actual payable amount) separately to handle discounts', async () => {
    const initResponse = {
      status: 'Success',
      conversationId: 'pay-1',
      token: 'tok-xyz',
      checkoutFormContent: '<script>iyzicoForm</script>',
      paymentPageUrl: 'https://sandbox-cpp.iyzipay.com/?token=tok-xyz',
    };

    const { client, captured } = buildTestClient([initResponse]);
    const cart = {
      ...sessionRequest.cart,
      id: 'cart-2',
      totalPrice: { centAmount: 4490, currencyCode: 'TRY', fractionDigits: 2 },
      shippingInfo: {
        price: { centAmount: 500, currencyCode: 'TRY', fractionDigits: 2 },
      },
      lineItems: [
        {
          id: 'li-1',
          name: { tr: 'Tişört' },
          quantity: 1,
          totalPrice: {
            centAmount: 4990,
            currencyCode: 'TRY',
            fractionDigits: 2,
          },
        },
      ],
    };

    const ct = makeCTServicesMock();
    ct.cart.getCart.mockResolvedValue(cart);
    ct.payment.createPayment.mockResolvedValue({
      id: 'pay-1',
      version: 1,
    } as any);
    ct.payment.updatePayment.mockResolvedValue({
      id: 'pay-1',
      version: 2,
    } as any);
    ct.cart.addPayment.mockResolvedValue(cart);

    await makePaymentService(ct, client).createSession({
      ...sessionRequest,
      cart: cart,
    });

    const sent = JSON.parse(captured[0].data as string);

    // price = sum of items (with shipping): 49.90 + 5.00
    expect(sent.price).toBe('54.90');
    // paidPrice = actual amount to charge (after discount): 44.90
    expect(sent.paidPrice).toBe('44.90');
    // basket items are sent at their original prices
    expect(sent.basketItems.map((item: any) => item.price)).toEqual(['49.90', '5.00']);
  });

  it('does not include free shipping in basket items', () => {
    const cart = {
      id: 'cart-free-shipping',
      locale: 'tr-TR',
      totalPrice: {
        centAmount: 667900,
        currencyCode: 'TRY',
        fractionDigits: 2,
      },
      lineItems: [
        {
          id: 'li-1',
          name: { tr: 'Product' },
          totalPrice: {
            centAmount: 667900,
            currencyCode: 'TRY',
            fractionDigits: 2,
          },
        },
      ],
      shippingInfo: {
        price: { centAmount: 399, currencyCode: 'TRY', fractionDigits: 2 },
        discountedPrice: {
          value: { centAmount: 0, currencyCode: 'TRY', fractionDigits: 2 },
          includedDiscounts: [],
        },
      },
    };

    const basketItems = mapBasketItems(cart);

    expect(basketItems.map((item: any) => item.price)).toEqual(['6679.00']);
  });
});