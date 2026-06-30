/**
 * Card storage (save) — when the shopper saves a card on the hosted form, the
 * retrieve returns cardToken + cardUserKey and we persist it as a CT PaymentMethod
 * (the Adyen mechanism). And init passes the customer's existing cardUserKey so
 * saves stay under one key.
 */

import type { Cart } from '@commercetools/platform-sdk';
import { buildTestClient } from './helpers/test-client';
import {makeCart, makeCt, makePaymentService, sessionRequest } from './helpers/ct-client-mock';

const retrieveWithSavedCard = {
  status: 'success',
  paymentStatus: 'SUCCESS',
  paymentId: 'iyz-999',
  fraudStatus: 1,
  conversationId: 'pay-1',
  token: 'tok-xyz',
  cardAssociation: 'MASTER_CARD',
  lastFourDigits: '0008',
  binNumber: '552879',
  cardToken: 'card-tok-1',
  cardUserKey: 'user-key-1',
};

jest.mock('@commercetools/connect-payments-sdk', () => ({
  getProcessorUrlFromContext: () => 'https://processor.example',
  getCtSessionIdFromContext: () => 'sess-1',
  getMerchantReturnUrlFromContext: () => 'https://shop.example/return',
  GenerateInterfaceInteractionCustomFieldsDraft: (input: any) => ({
    fields: input,
  }),
}));

describe('card storage — save on confirm', () => {
  afterEach(() => jest.restoreAllMocks());

  it('persists the saved card as a CT PaymentMethod (token packs cardUserKey + cardToken)', async () => {
    // retrieve, then the /cardstorage/cards lookup that supplies the expiry.
    const { client } = buildTestClient([
      retrieveWithSavedCard,
      { status: 'success', cardDetails: [{ cardToken: 'card-tok-1', expireMonth: '12', expireYear: '2030' }] },
    ]);
    const ct = makeCt(); // getCartByPaymentId → cart with customerId 'cust-1'

    await makePaymentService(ct, client).handleCallback({
      token: 'tok-xyz',
      returnUrl: 'https://shop.example/return',
    });

    expect(ct.carts.getCartByPaymentId).toHaveBeenCalledWith({ paymentId: 'pay-1' });
    expect(ct.paymentMethods.save).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: 'cust-1',
        paymentInterface: 'iyzico',
        method: 'MASTER_CARD',
        token: 'user-key-1::card-tok-1', // packed: cardUserKey :: cardToken
      }),
    );

    // card details (+ expiry enriched from /cardstorage/cards) via the SDK draft helper
    const saved = ct.paymentMethods.save.mock.calls[0][0] as any;
    expect(saved.customFields.fields).toMatchObject({
      brand: 'MASTER_CARD',
      lastFour: '0008',
      bin: '552879',
      expiryMonth: 12,
      expiryYear: 2030,
      storePaymentMethod: true
    });
  });

  it('does NOT save a card when the retrieve has no card token', async () => {
    const { client } = buildTestClient([
      { status: 'success', paymentStatus: 'SUCCESS', paymentId: 'iyz-999', fraudStatus: 1, conversationId: 'pay-1', token: 'tok-xyz' },
    ]);
    const ct = makeCt();

    await makePaymentService(ct, client).handleCallback({ token: 'tok-xyz', returnUrl: 'https://shop.example/return' });

    expect(ct.paymentMethods.save).not.toHaveBeenCalled();
  });

  it('does NOT save for a guest cart (no customerId)', async () => {
    const { client } = buildTestClient([retrieveWithSavedCard]);
    const guestCart = { ...makeCart(), customerId: undefined } as unknown as Cart;
    const ct = makeCt({ carts: { getCartByPaymentId: jest.fn().mockResolvedValue(guestCart) } });

    await makePaymentService(ct, client).handleCallback({ token: 'tok-xyz', returnUrl: 'https://shop.example/return' });

    expect(ct.paymentMethods.save).not.toHaveBeenCalled();
  });
});

describe('card storage — init passes the existing cardUserKey', () => {
  afterEach(() => jest.restoreAllMocks());

  it('reads the customer’s cardUserKey from a saved PaymentMethod and sends it to the form', async () => {
    const initResponse = {
      status: 'success',
      conversationId: 'pay-1',
      token: 'tok-xyz',
      checkoutFormContent: '<script>f</script>',
      paymentPageUrl: 'https://pay/x',
    };
    const { client, captured } = buildTestClient([initResponse]);
    const existing = {
      token: 'user-key-1::card-tok-1',
      customFields: { fields: { token: 'user-key-1::card-tok-1' } }
    } as any;
    const ct = makeCt({
      paymentMethods: { find: jest.fn().mockResolvedValue({ results: [existing] }) },
    });

    await makePaymentService(ct, client).createSession(sessionRequest);

    expect(ct.paymentMethods.find).toHaveBeenCalledWith({ customerId: 'cust-1', paymentInterface: 'iyzico' });
    const sent = JSON.parse(captured[0].data as string);
    expect(sent.cardUserKey).toBe('user-key-1');
  });
});