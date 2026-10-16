import { BadRequestException } from '@nestjs/common';
import { IyzicoRefundService } from '../src/iyzico/iyzico-refund.service';
import { makeCTServicesMock, makeIyzicoMock } from './helpers/ct-client-mock';

const REFUND_V2 = '/v2/payment/refund';

const paymentAmount = { centAmount: 10000, currencyCode: 'TRY', fractionDigits: 2, type: 'centPrecision' };

function iyzicoPayment(overrides: Record<string, unknown> = {}) {
    return {
        id: 'ct-payment-1',
        amountPlanned: paymentAmount,
        createdAt: new Date().toISOString(),
        custom: {
            fields: {
                conversationId: 'RCSTR000000001',
                iyzicoPaymentId: '38256109',
            },
        },
        ...overrides,
    } as any;
}

const fullRefund = { amount: { centAmount: 10000, currencyCode: 'TRY' }, merchantReference: 'RCSTR000000001' };

// shapes taken from real sandbox responses
const refundAccepted = {
    status: 'success',
    paymentId: '38256109',
    price: 100,
    currency: 'TRY',
    refundHostReference: 'mock00001iyzihostrfn-02',
    retryable: false,
};
const alreadyReversed = {
    status: 'failure',
    errorCode: '5088',
    errorMessage: 'Ödeme önceden iptal edilmiştir',
    paymentId: '38256109',
    retryable: false,
};
const refused = {
    status: 'failure',
    errorCode: '5074',
    errorMessage: 'Refund refused',
    retryable: false,
};

function makeService() {
    const ct = makeCTServicesMock();
    const iyzico = makeIyzicoMock();
    ct.payment.updatePayment.mockResolvedValue(iyzicoPayment());
    return { ct, iyzico, service: new IyzicoRefundService(ct.payment, iyzico.client) };
}

describe('IyzicoRefundService', () => {
    it('refunds the whole payment with a single Iyzico call', async () => {
        const { ct, iyzico, service } = makeService();
        ct.payment.getPayment.mockResolvedValue(iyzicoPayment());
        iyzico.client.post.mockResolvedValue(refundAccepted);

        await expect(service.refundPayment('ct-payment-1', fullRefund)).resolves.toBe('approved');

        expect(iyzico.client.post).toHaveBeenCalledTimes(1);
        expect(iyzico.client.post).toHaveBeenCalledWith(REFUND_V2, {
            locale: 'tr',
            conversationId: 'RCSTR000000001',
            paymentId: '38256109',
            price: '100.00',
            currency: 'TRY',
        });
    });

    it('records a successful refund as a Refund transaction on the payment', async () => {
        const { ct, iyzico, service } = makeService();
        ct.payment.getPayment.mockResolvedValue(iyzicoPayment());
        iyzico.client.post.mockResolvedValue(refundAccepted);

        await service.refundPayment('ct-payment-1', fullRefund);

        expect(ct.payment.updatePayment).toHaveBeenCalledWith(
            expect.objectContaining({
                id: 'ct-payment-1',
                transaction: expect.objectContaining({
                    type: 'Refund',
                    state: 'Success',
                    interactionId: 'mock00001iyzihostrfn-02',
                }),
            }),
        );
    });

    it('treats an already reversed payment as approved without recording a failure', async () => {
        const { ct, iyzico, service } = makeService();
        ct.payment.getPayment.mockResolvedValue(iyzicoPayment());
        iyzico.client.post.mockResolvedValue(alreadyReversed);

        await expect(service.refundPayment('ct-payment-1', fullRefund)).resolves.toBe('approved');
        expect(ct.payment.updatePayment).not.toHaveBeenCalled();
    });

    it('rejects and records the failure when Iyzico refuses the refund', async () => {
        const { ct, iyzico, service } = makeService();
        ct.payment.getPayment.mockResolvedValue(iyzicoPayment());
        iyzico.client.post.mockResolvedValue(refused);

        await expect(service.refundPayment('ct-payment-1', fullRefund)).resolves.toBe('rejected');
        expect(ct.payment.updatePayment).toHaveBeenCalledWith(
            expect.objectContaining({
                transaction: expect.objectContaining({ type: 'Refund', state: 'Failure' }),
            }),
        );
    });

    it('lets a transport failure bubble up instead of recording a refund that may have gone through', async () => {
        const { ct, iyzico, service } = makeService();
        ct.payment.getPayment.mockResolvedValue(iyzicoPayment());
        iyzico.client.post.mockRejectedValue(new Error('socket hang up'));

        await expect(service.refundPayment('ct-payment-1', fullRefund)).rejects.toThrow('socket hang up');
        expect(ct.payment.updatePayment).not.toHaveBeenCalled();
    });

    it('refuses to refund when the Iyzico payment id was never stored', async () => {
        const { ct, iyzico, service } = makeService();
        ct.payment.getPayment.mockResolvedValue(
            iyzicoPayment({ custom: { fields: { conversationId: 'RCSTR000000001' } } }),
        );

        await expect(service.refundPayment('ct-payment-1', fullRefund)).rejects.toThrow(BadRequestException);
        expect(iyzico.client.post).not.toHaveBeenCalled();
    });

    it('refuses to refund a payment that belongs to another order', async () => {
        const { ct, iyzico, service } = makeService();
        ct.payment.getPayment.mockResolvedValue(iyzicoPayment());

        await expect(
            service.refundPayment('ct-payment-1', { ...fullRefund, merchantReference: 'RCSTR000000999' }),
        ).rejects.toThrow(BadRequestException);
        expect(iyzico.client.post).not.toHaveBeenCalled();
    });

    it('refuses a partial refund', async () => {
        const { ct, iyzico, service } = makeService();
        ct.payment.getPayment.mockResolvedValue(iyzicoPayment());

        await expect(
            service.refundPayment('ct-payment-1', { amount: { centAmount: 5000, currencyCode: 'TRY' } }),
        ).rejects.toThrow(BadRequestException);
        expect(iyzico.client.post).not.toHaveBeenCalled();
    });
});
