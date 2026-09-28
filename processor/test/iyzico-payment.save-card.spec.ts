import type { Cart } from '@commercetools/platform-sdk';
import { buildTestClient } from './helpers/test-client';
import {
    makeCart,
    makeCTServicesMock,
    makePaymentService,
    sessionRequest,
} from './helpers/ct-client-mock';

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

const makePaymentFixture = () => ({
    id: 'pay-1',
    amountPlanned: { centAmount: 4990, currencyCode: 'TRY' },
    transactions: [{ type: 'Charge', state: 'Initial' }],
}) as any;

const makeCartWithLineItem = (overrides: Partial<Cart> = {}) => makeCart({
    customerId: 'cust-1',
    totalPrice: { centAmount: 4990, currencyCode: 'TRY', type: 'centPrecision', fractionDigits: 2 } as any,
    lineItems: [
        {
            id: 'li-1',
            productId: 'prod-1',
            name: { en: 'Test' },
            quantity: 1,
            totalPrice: { centAmount: 4990, currencyCode: 'TRY', type: 'centPrecision', fractionDigits: 2 },
            variant: { id: 1, sku: 'sku-1' },
        } as any,
    ],
    ...overrides,
});

jest.mock('@commercetools/connect-payments-sdk', () => {
    const actual = jest.requireActual('@commercetools/connect-payments-sdk');
    return {
        ...actual,
        getProcessorUrlFromContext: jest.fn().mockReturnValue('https://processor.example'),
        getCtSessionIdFromContext: jest.fn().mockReturnValue('sess-1'),
        getMerchantReturnUrlFromContext: jest.fn().mockReturnValue('https://shop.example/return'),
        getFutureOrderNumberFromContext: jest.fn().mockReturnValue(undefined),
        GenerateInterfaceInteractionCustomFieldsDraft: (input: any) => ({ fields: input }),
    };
});

describe('card storage — save on confirm', () => {
    afterEach(() => jest.restoreAllMocks());

    it('persists the saved card as a CT PaymentMethod (token packs cardUserKey + cardToken)', async () => {
        const { client } = buildTestClient([
            retrieveWithSavedCard,
            {
                status: 'success',
                cardDetails: [{ cardToken: 'card-tok-1', expireMonth: '12', expireYear: '2030' }],
            },
        ]);

        const ct = makeCTServicesMock();
        const payment = makePaymentFixture();

        ct.payment.findPaymentsByInterfaceId.mockResolvedValue([payment]);
        ct.cart.getCartByPaymentId.mockResolvedValue(makeCartWithLineItem());
        ct.payment.updatePayment.mockResolvedValue(payment);
        ct.paymentMethods.save.mockResolvedValue({ id: 'pm-1' } as any);

        const service = makePaymentService(ct, client);

        await service.handleCallback({
            token: 'tok-xyz',
            returnUrl: 'https://shop.example/return',
        });

        expect(ct.cart.getCartByPaymentId).toHaveBeenCalledWith({ paymentId: 'pay-1' });
        expect(ct.paymentMethods.save).toHaveBeenCalledWith(
            expect.objectContaining({
                customerId: 'cust-1',
                paymentInterface: 'iyzico',
                method: 'MASTER_CARD',
                token: 'user-key-1::card-tok-1',
            }),
        );

        const saved = ct.paymentMethods.save.mock.calls[0][0] as any;
        expect(saved.customFields.fields).toMatchObject({
            brand: 'MASTER_CARD',
            lastFour: '0008',
            bin: '552879',
            expiryMonth: 12,
            expiryYear: 2030,
        });
    });

    it('does NOT save a card when the retrieve has no card token', async () => {
        const { client } = buildTestClient([
            {
                status: 'success',
                paymentStatus: 'SUCCESS',
                paymentId: 'iyz-999',
                fraudStatus: 1,
                conversationId: 'pay-1',
                token: 'tok-xyz',
            },
        ]);

        const ct = makeCTServicesMock();
        const payment = makePaymentFixture();

        ct.payment.findPaymentsByInterfaceId.mockResolvedValue([payment]);
        ct.cart.getCartByPaymentId.mockResolvedValue(makeCartWithLineItem());
        ct.payment.updatePayment.mockResolvedValue(payment);

        const service = makePaymentService(ct, client);

        await service.handleCallback({ token: 'tok-xyz', returnUrl: 'https://shop.example/return' });

        expect(ct.paymentMethods.save).not.toHaveBeenCalled();
    });

    it('does NOT save for a guest cart (no customerId)', async () => {
        const { client } = buildTestClient([retrieveWithSavedCard]);

        const ct = makeCTServicesMock();
        const payment = makePaymentFixture();
        const guestCart = { ...makeCartWithLineItem(), customerId: undefined } as unknown as Cart;

        ct.payment.findPaymentsByInterfaceId.mockResolvedValue([payment]);
        ct.cart.getCartByPaymentId.mockResolvedValue(guestCart);
        ct.payment.updatePayment.mockResolvedValue(payment);

        const service = makePaymentService(ct, client);

        await service.handleCallback({ token: 'tok-xyz', returnUrl: 'https://shop.example/return' });

        expect(ct.paymentMethods.save).not.toHaveBeenCalled();
    });
});

describe('card storage — init passes the existing cardUserKey', () => {
    afterEach(() => jest.restoreAllMocks());

    it("reads the customer's cardUserKey from a saved PaymentMethod and sends it to the form", async () => {
        const initResponse = {
            status: 'success',
            conversationId: 'pay-1',
            token: 'tok-xyz',
            checkoutFormContent: '<script>f</script>',
            paymentPageUrl: 'https://pay/x',
        };
        const { client, captured } = buildTestClient([initResponse]);

        const existing = {
            token: { value: 'user-key-1::card-tok-1' },
            customFields: { fields: { token: 'user-key-1::card-tok-1' } },
        } as any;

        const cartWithCustomer = makeCartWithLineItem({ customerId: 'cust-1' });

        const ct = makeCTServicesMock();
        ct.cart.getCart.mockResolvedValue(cartWithCustomer);
        ct.payment.createPayment.mockResolvedValue({ id: 'pay-1', version: 1 } as any);
        ct.payment.updatePayment.mockResolvedValue({ id: 'pay-1', version: 2 } as any);
        ct.cart.addPayment.mockResolvedValue(cartWithCustomer);
        ct.paymentMethods.find.mockResolvedValue({ results: [existing] } as any);

        const service = makePaymentService(ct, client);

        await service.createSession({
            cartId: 'cart-1',
            clientIp: '1.2.3.4',
            cart: cartWithCustomer,
        });

        expect(ct.paymentMethods.find).toHaveBeenCalledWith({
            customerId: 'cust-1',
            paymentInterface: 'iyzico',
        });

        const sent = JSON.parse(captured[0].data as string);
        expect(sent.cardUserKey).toBe('user-key-1');
    });
});