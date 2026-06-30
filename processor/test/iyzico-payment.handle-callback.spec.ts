import type { Payment } from '@commercetools/platform-sdk';
import { buildTestClient } from './helpers/test-client';
import {makeCt, makePaymentService, money } from './helpers/ct-client-mock';

const successRetrieve = {
    status: 'Success',
    paymentStatus: 'SUCCESS',
    paymentId: 'iyz-999',
    fraudStatus: 1,
    conversationId: 'pay-1',
    token: 'tok-xyz',
    cardAssociation: 'MASTER_CARD',
};

jest.mock('@commercetools/connect-payments-sdk', () => ({
  getProcessorUrlFromContext: () => 'https://processor.example',
  getCtSessionIdFromContext: () => 'sess-1',
  getMerchantReturnUrlFromContext: () => 'https://shop.example/return',
  GenerateInterfaceInteractionCustomFieldsDraft: (input: any) => ({
    fields: input,
  }),
}));

describe('IyzicoPaymentService.handleCallback — finalize the payment', () => {
    afterEach(() => jest.restoreAllMocks());

    it('retrieves by token, records a Charge/Success with the card brand, returns the outcome', async () => {
        const { client, captured } = buildTestClient([successRetrieve]);
        const ct = makeCt();

        const redirectUrl = await makePaymentService(ct, client).handleCallback({
            token: 'tok-xyz',
            returnUrl: 'https://shop.example/return',
        });

        expect(ct.payments.findPaymentsByInterfaceId).toHaveBeenCalledWith({ interfaceId: 'tok-xyz' });

       
        expect(captured[0].url).toBe('/payment/iyzipos/checkoutform/auth/ecom/detail');
        const sent = JSON.parse(captured[0].data as string);
        expect(sent.token).toBe('tok-xyz');
        expect(sent.conversationId).toBe('pay-1');

        expect(ct.payments.updatePayment).toHaveBeenCalledWith(
            expect.objectContaining({
                id: 'pay-1',
                paymentMethod: 'MASTER_CARD',
                transaction: expect.objectContaining({
                    type: 'Charge',
                    state: 'Success',
                    interactionId: 'tok-xyz',
                }),
            }),
        );

        // Verify the URL contains the expected success parameters
        const url = new URL(redirectUrl!);
        expect(url.searchParams.get('paymentReference')).toBe('pay-1');
        expect(url.searchParams.get('paymentStatus')).toBe('Success');
    });

    it('FRAUD: audits the real reason on CT but returns a GENERIC code to the front', async () => {
        const { client } = buildTestClient([
            {
                status: 'Success',
                paymentStatus: 'FAILURE',
                conversationId: 'pay-1',
                fraudStatus: -1,
                errorCode: '10051',
                errorMessage: 'Insufficient funds',
            },
        ]);
        const ct = makeCt();

        const redirectUrl = await makePaymentService(ct, client).handleCallback({
            token: 'tok-xyz',
            returnUrl: 'https://shop.example/return',
        });

        const update = ct.payments.updatePayment.mock.calls[0][0] as any;
        expect(update.transaction).toMatchObject({ type: 'Charge', state: 'Failure' });
        const audited = JSON.parse(update.pspInteractions[0].fields.response);
        expect(audited).toMatchObject({ errorCode: '10051', errorMessage: 'Insufficient funds', fraudStatus: -1 });

        expect(new URL(redirectUrl!).searchParams.get('errorCode')).toBe('GENERIC_ERROR');
    });

    it('DECLINE: exposes the real Iyzico error code to the front (non-fraud)', async () => {
        const { client } = buildTestClient([
            {
                status: 'Success',
                paymentStatus: 'FAILURE',
                conversationId: 'pay-1',
                fraudStatus: 1,
                errorCode: '10051',
                errorMessage: 'Insufficient funds',
            },
        ]);
        const ct = makeCt();

        const redirectUrl = await makePaymentService(ct, client).handleCallback({
            token: 'tok-xyz',
            returnUrl: 'https://shop.example/return',
        });

        expect(new URL(redirectUrl!).searchParams.get('errorCode')).toBe('10051');
    });

    it('redirects to the return URL with the result', async () => {
        const { client } = buildTestClient([successRetrieve]);

        const redirectUrl = await makePaymentService(makeCt(), client).handleCallback({
            token: 'tok-xyz',
            returnUrl: 'https://shop.example/return',
        });

        const url = new URL(redirectUrl!);
        expect(url.origin + url.pathname).toBe('https://shop.example/return');
        expect(url.searchParams.get('paymentReference')).toBe('pay-1');
        expect(url.searchParams.get('paymentStatus')).toBe('Success');
    });

    it('is idempotent: a duplicate callback on a settled payment does not record again', async () => {
        const { client, captured } = buildTestClient([]); // retrieve must NOT be called

        // The payment was already finalized by the first callback.
        const finalized = {
            id: 'pay-1',
            amountPlanned: money(4990),
            interfaceId: 'tok-xyz',
            transactions: [{ type: 'Charge', state: 'Success' }],
        } as unknown as Payment;

        // Using `as any` to silence strict TS mock shape requirements
        const ct = makeCt({
            payments: {
                findPaymentsByInterfaceId: jest.fn().mockResolvedValue([finalized])
            } as any,
            paymentMethods: {
                save: jest.fn().mockResolvedValue({})
            } as any
        });
        const redirectUrl = await makePaymentService(ct, client).handleCallback({
            token: 'tok-xyz',
            returnUrl: 'https://shop.example/return',
        });

        expect(captured).toHaveLength(0); // no second retrieve to Iyzico
        expect(ct.payments.updatePayment).not.toHaveBeenCalled(); // no duplicate write
        expect(new URL(redirectUrl!).searchParams.get('paymentStatus')).toBe('Success');
    });
});