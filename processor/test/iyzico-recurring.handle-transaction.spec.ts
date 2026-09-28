import { IyzicoRecurringService } from '../src/iyzico/iyzico-recurring.service';
import { makeCart, makeCTServicesMock, makeIyzicoMock, makePayment } from './helpers/ct-client-mock';

describe('IyzicoRecurringService.handleTransaction', () => {
    let service: IyzicoRecurringService;
    let ct: ReturnType<typeof makeCTServicesMock>;
    let iyzico: ReturnType<typeof makeIyzicoMock>;

    beforeEach(() => {
        ct = makeCTServicesMock();
        iyzico = makeIyzicoMock();
        service = new IyzicoRecurringService(iyzico.client, ct.cart, ct.payment, ct.paymentMethods);
    });

    it('charges the stored card with its cardUserKey and cardToken in the right fields', async () => {
        const cart = makeCart({
            id: 'c-1',
            customerId: 'customer-1',
            custom: { fields: { paymentMethodId: 'pm-1' } } as any,
        });

        ct.paymentMethods.get.mockResolvedValue({ id: 'pm-1', token: { value: 'user-key-1::card-tok-1' } } as any);
        ct.payment.createPayment.mockResolvedValue(makePayment({ id: 'p-1' }));
        ct.cart.getCart.mockResolvedValue(cart);
        iyzico.client.post.mockResolvedValue({ status: 'success', paymentId: '123', conversationId: 'conv-1', fraudStatus: 1 });

        const response = await service.handleTransaction(
            { key: 'refill-1', transactionItems: [{ amount: { centAmount: 10000, currencyCode: 'TRY' } }] } as any,
            cart,
        );

        expect(iyzico.client.post).toHaveBeenCalledWith(
            '/payment/auth',
            expect.objectContaining({
                paymentCard: expect.objectContaining({ cardToken: 'card-tok-1', cardUserKey: 'user-key-1' }),
            }),
        );
        expect(response.transactionStatus.state).toBe('Completed');
    });
});
