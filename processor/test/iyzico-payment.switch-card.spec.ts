import { IyzicoPaymentService } from '../src/iyzico/iyzico-payment.service';
import { isSameIyzicoDay } from '../src/iyzico/converters/iyzico-refund.converter';
import {
    makeCTServicesMock,
    makeConfigMock,
    makeCart,
    makeIyzicoCardServiceMock,
    makeIyzicoMock,
    makePayment,
} from './helpers/ct-client-mock';

jest.mock('@commercetools/connect-payments-sdk', () => {
    const actual = jest.requireActual('@commercetools/connect-payments-sdk');
    return {
        ...actual,
        getFutureOrderNumberFromContext: jest.fn().mockReturnValue(undefined),
        GenerateInterfaceInteractionCustomFieldsDraft: (input: any) => ({ fields: input }),
    };
});

const retrieveSuccess = {
    status: 'success',
    paymentStatus: 'SUCCESS',
    paymentId: 'iyz-1',
    fraudStatus: 1,
    conversationId: 'SUBKEY1_cart-1',
    cardAssociation: 'VISA',
    lastFourDigits: '0008',
    binNumber: '552879',
    cardToken: 'card-tok-1',
    cardUserKey: 'user-key-1',
};

const makeSwitchCardCart = (lineItemFields: Record<string, unknown>) => makeCart({
    id: 'cart-1',
    customerId: 'cust-1',
    totalPrice: { centAmount: 100, currencyCode: 'TRY', type: 'centPrecision', fractionDigits: 2 } as any,
    lineItems: [
        {
            id: 'li-1',
            name: { en: 'Card verification' },
            quantity: 1,
            totalPrice: { centAmount: 100, currencyCode: 'TRY', type: 'centPrecision', fractionDigits: 2 },
            custom: { fields: lineItemFields },
        } as any,
    ],
});

describe('IyzicoPaymentService switch card', () => {
    let service: IyzicoPaymentService;
    let ct: ReturnType<typeof makeCTServicesMock>;
    let iyzico: ReturnType<typeof makeIyzicoMock>;

    const payment = makePayment({
        id: 'p-1',
        amountPlanned: { centAmount: 100, currencyCode: 'TRY', fractionDigits: 2 } as any,
    });

    beforeEach(() => {
        ct = makeCTServicesMock();
        iyzico = makeIyzicoMock();

        service = new IyzicoPaymentService(
            ct.cart,
            ct.payment,
            iyzico.client,
            makeIyzicoCardServiceMock() as any,
            makeConfigMock(),
        );

        ct.payment.findPaymentsByInterfaceId.mockResolvedValue([payment]);
        ct.payment.updatePayment.mockResolvedValue(payment);
    });

    it('stores the card then refunds a verification charge from a previous day through refund v2', async () => {
        ct.cart.getCartByPaymentId.mockResolvedValue(
            makeSwitchCardCart({ frequency_code: '4W', subscription_key: 'SUBKEY1' }),
        );
        iyzico.client.post
            .mockResolvedValueOnce(retrieveSuccess)
            .mockResolvedValueOnce({ status: 'success', paymentId: 'iyz-1', price: 1, refundHostReference: 'ref-1' });

        await service.handleCallback({ token: 'tok-1', returnUrl: 'https://bff.example/callback' });

        expect(iyzico.client.post).toHaveBeenLastCalledWith('/v2/payment/refund', {
            locale: 'tr',
            conversationId: 'SUBKEY1_cart-1',
            paymentId: 'iyz-1',
            price: '1.00',
            currency: 'TRY',
        });

        expect(ct.payment.updatePayment).toHaveBeenCalledWith(
            expect.objectContaining({
                id: 'p-1',
                transaction: expect.objectContaining({ type: 'Charge', state: 'Success' }),
                customFields: expect.objectContaining({ fields: expect.objectContaining({ cardId: 'pm-1' }) }),
            }),
        );
        expect(ct.payment.updatePayment).not.toHaveBeenCalledWith(
            expect.objectContaining({ customFieldValues: expect.anything() }),
        );
        expect(ct.payment.updatePayment).toHaveBeenCalledWith(
            expect.objectContaining({
                id: 'p-1',
                transaction: expect.objectContaining({ type: 'Refund', state: 'Success', interactionId: 'ref-1' }),
            }),
        );
    });

    it('cancels a verification charge made the same day', async () => {
        ct.payment.findPaymentsByInterfaceId.mockResolvedValue([{ ...payment, createdAt: new Date().toISOString() }]);
        ct.cart.getCartByPaymentId.mockResolvedValue(
            makeSwitchCardCart({ frequency_code: '4W', subscription_key: 'SUBKEY1' }),
        );
        iyzico.client.post
            .mockResolvedValueOnce(retrieveSuccess)
            .mockResolvedValueOnce({ status: 'success', paymentId: 'iyz-1', cancelHostReference: 'cancel-ref-1' });

        await service.handleCallback({ token: 'tok-1', returnUrl: 'https://bff.example/callback' });

        expect(iyzico.client.post).toHaveBeenLastCalledWith('/payment/cancel', {
            locale: 'tr',
            conversationId: 'SUBKEY1_cart-1',
            paymentId: 'iyz-1',
        });
        expect(iyzico.client.post).not.toHaveBeenCalledWith('/v2/payment/refund', expect.anything());
        expect(ct.payment.updatePayment).toHaveBeenCalledWith(
            expect.objectContaining({
                transaction: expect.objectContaining({ type: 'Refund', state: 'Success', interactionId: 'cancel-ref-1' }),
                pspInteractions: [
                    expect.objectContaining({ fields: expect.objectContaining({ type: 'iyzico-cancel-success' }) }),
                ],
            }),
        );
    });

    it('falls back to a refund when Iyzico refuses the same day cancel', async () => {
        ct.payment.findPaymentsByInterfaceId.mockResolvedValue([{ ...payment, createdAt: new Date().toISOString() }]);
        ct.cart.getCartByPaymentId.mockResolvedValue(
            makeSwitchCardCart({ frequency_code: '4W', subscription_key: 'SUBKEY1' }),
        );
        iyzico.client.post
            .mockResolvedValueOnce(retrieveSuccess)
            .mockResolvedValueOnce({ status: 'failure', errorCode: '5088', errorMessage: 'cancel refused' })
            .mockResolvedValueOnce({ status: 'success', paymentId: 'iyz-1', refundHostReference: 'ref-1' });

        await service.handleCallback({ token: 'tok-1', returnUrl: 'https://bff.example/callback' });

        expect(iyzico.client.post).toHaveBeenCalledWith('/payment/cancel', expect.anything());
        expect(iyzico.client.post).toHaveBeenLastCalledWith('/v2/payment/refund', expect.anything());
        expect(ct.payment.updatePayment).toHaveBeenCalledWith(
            expect.objectContaining({
                transaction: expect.objectContaining({ type: 'Refund', state: 'Success', interactionId: 'ref-1' }),
                pspInteractions: [
                    expect.objectContaining({ fields: expect.objectContaining({ type: 'iyzico-refund-success' }) }),
                ],
            }),
        );
    });

    it('records a failed refund when Iyzico refuses it', async () => {
        ct.cart.getCartByPaymentId.mockResolvedValue(
            makeSwitchCardCart({ frequency_code: '4W', subscription_key: 'SUBKEY1' }),
        );
        iyzico.client.post
            .mockResolvedValueOnce(retrieveSuccess)
            .mockResolvedValueOnce({ status: 'failure', errorCode: '5093', errorMessage: 'refund refused' });

        await service.handleCallback({ token: 'tok-1', returnUrl: 'https://bff.example/callback' });

        expect(ct.payment.updatePayment).toHaveBeenCalledWith(
            expect.objectContaining({
                transaction: expect.objectContaining({ type: 'Refund', state: 'Failure' }),
            }),
        );
    });

    it('does not refund a regular subscription checkout', async () => {
        ct.cart.getCartByPaymentId.mockResolvedValue(makeSwitchCardCart({ frequency_code: '4W' }));
        iyzico.client.post.mockResolvedValueOnce(retrieveSuccess);

        await service.handleCallback({ token: 'tok-1', returnUrl: 'https://bff.example/callback' });

        expect(iyzico.client.post).not.toHaveBeenCalledWith('/v2/payment/refund', expect.anything());
        expect(ct.payment.updatePayment).not.toHaveBeenCalledWith(
            expect.objectContaining({ transaction: expect.objectContaining({ type: 'Refund' }) }),
        );
    });

    it('does not refund a recurring order cart paid through the form', async () => {
        ct.cart.getCartByPaymentId.mockResolvedValue({
            ...makeSwitchCardCart({ frequency_code: '4W', subscription_key: 'SUBKEY1' }),
            custom: { fields: { orderTimes: 3 } },
        } as any);
        iyzico.client.post.mockResolvedValueOnce(retrieveSuccess);

        await service.handleCallback({ token: 'tok-1', returnUrl: 'https://bff.example/callback' });

        expect(iyzico.client.post).toHaveBeenCalledTimes(1);
        expect(ct.payment.updatePayment).not.toHaveBeenCalledWith(
            expect.objectContaining({ transaction: expect.objectContaining({ type: 'Refund' }) }),
        );
    });

    it('does not refund when the verification charge failed', async () => {
        ct.cart.getCartByPaymentId.mockResolvedValue(
            makeSwitchCardCart({ frequency_code: '4W', subscription_key: 'SUBKEY1' }),
        );
        iyzico.client.post.mockResolvedValueOnce({ ...retrieveSuccess, paymentStatus: 'FAILURE' });

        await service.handleCallback({ token: 'tok-1', returnUrl: 'https://bff.example/callback' });

        expect(iyzico.client.post).toHaveBeenCalledTimes(1);
    });
});

describe('isSameIyzicoDay', () => {
    it('compares days in Turkey time', () => {
        // 23:59 and 00:01 in Istanbul (UTC+3) are two different Iyzico days
        expect(isSameIyzicoDay(new Date('2026-09-24T20:59:00Z'), new Date('2026-09-24T21:01:00Z'))).toBe(false);
        // 00:30 and 23:30 in Istanbul are the same Iyzico day although they are on two UTC days
        expect(isSameIyzicoDay(new Date('2026-09-23T21:30:00Z'), new Date('2026-09-24T20:30:00Z'))).toBe(true);
    });
});
