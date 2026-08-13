import { InternalServerErrorException } from '@nestjs/common';
import { buildTestClient } from './helpers/test-client';
import {
  makeCTServicesMock,
  makePaymentService,
  sessionRequest,
} from './helpers/ct-client-mock';

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
});