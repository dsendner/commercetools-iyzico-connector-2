import { IyzicoPaymentService } from '../src/iyzico/iyzico-payment.service';
import {
    makeCTServicesMock,
    makeIyzicoMock,
    makeConfigMock,
    makePayment,
    makeCart,
} from './helpers/ct-client-mock';

describe('IyzicoPaymentService.handleCallback', () => {
    let service: IyzicoPaymentService;
    let ct: ReturnType<typeof makeCTServicesMock>;
    let iyzico: ReturnType<typeof makeIyzicoMock>;
    let config: ReturnType<typeof makeConfigMock>;

    beforeEach(() => {
        ct = makeCTServicesMock();
        iyzico = makeIyzicoMock();
        config = makeConfigMock();

        service = new IyzicoPaymentService(
            ct.cart,
            ct.payment,
            iyzico.client,
            iyzico.cardService,
            config,
        );
    });

    it('retrieves by token, records Success with card brand', async () => {
        const payment = makePayment({ id: 'p-1' });
        const cart = makeCart({ id: 'c-1' });

        ct.payment.findPaymentsByInterfaceId.mockResolvedValue([payment]);
        ct.cart.getCartByPaymentId.mockResolvedValue(cart);
        iyzico.client.post.mockResolvedValue({
            status: 'success',
            paymentStatus: 'SUCCESS',
            fraudStatus: 1,
            cardAssociation: 'VISA',
            cardType: 'CREDIT_CARD',
            binNumber: '450803',
            lastFourDigits: '4444',
            price: 100,
            paidPrice: 100,
        });

        const redirectUrl = await service.handleCallback({
            token: 'iyzico-token-1',
            returnUrl: 'https://bff.example/callback',
        });

        expect(ct.payment.updatePayment).toHaveBeenCalledWith(
            expect.objectContaining({
                id: 'p-1',
                paymentMethod: 'VISA',
                transaction: expect.objectContaining({ state: 'Success' }),
            }),
        );

        const url = new URL(redirectUrl);
        expect(url.searchParams.get('paymentReference')).toBe('p-1');
    });



    it('FRAUD: audits real reason on CT (front reads status from Payment)', async () => {
        const payment = makePayment({ id: 'p-2' });
        const cart = makeCart({ id: 'c-2' });

        ct.payment.findPaymentsByInterfaceId.mockResolvedValue([payment]);
        ct.cart.getCartByPaymentId.mockResolvedValue(cart);
        iyzico.client.post.mockResolvedValue({
            status: 'success',
            paymentStatus: 'FAILURE',
            fraudStatus: -1,
            errorCode: '10034',
            errorMessage: 'Fraud detected',
        });

        await service.handleCallback({ token: 'iyzico-token-2', returnUrl: 'https://bff.example/callback' });

        expect(ct.payment.updatePayment).toHaveBeenCalledWith(
            expect.objectContaining({
                pspInteractions: expect.arrayContaining([
                    expect.objectContaining({
                        fields: expect.objectContaining({
                            response: expect.stringContaining('rejected'),
                        }),
                    }),
                ]),
            }),
        );
    });

    it('is idempotent: duplicate callback on settled payment does not record again', async () => {
        const payment = makePayment({
            id: 'p-3',
            transactions: [
                { type: 'Charge', state: 'Success', id: 't-1', timestamp: '2026-01-01T00:00:00Z', amount: { centAmount: 100, currencyCode: 'TRY' } } as any,
            ],
        });

        ct.payment.findPaymentsByInterfaceId.mockResolvedValue([payment]);

        const redirectUrl = await service.handleCallback({
            token: 'iyzico-token-3',
            returnUrl: 'https://bff.example/callback',
        });


        expect(iyzico.client.post).not.toHaveBeenCalled();

        expect(ct.payment.updatePayment).not.toHaveBeenCalled();

        const url = new URL(redirectUrl);
        expect(url.searchParams.get('paymentReference')).toBe('p-3');
    });
});