import { createHmac } from 'crypto';
import { UnauthorizedException } from '@nestjs/common';
import { buildTestClient, TEST_SECRET } from './helpers/test-client';
import {
    makeCTServicesMock,
    makePaymentService,
    makePayment,
} from './helpers/ct-client-mock';

const webhookPayload = {
    iyziEventType: 'CHECKOUT_FORM_AUTH',
    iyziPaymentId: 999,
    token: 'tok-xyz',
    paymentConversationId: 'pay-1',
    status: 'SUCCESS',
};

const sign = (p: typeof webhookPayload, secret = TEST_SECRET) =>
    createHmac('sha256', secret)
        .update(secret + p.iyziEventType + p.iyziPaymentId + p.token + p.paymentConversationId + p.status)
        .digest('hex');

const retrieveOk = {
    status: 'Success',
    paymentStatus: 'SUCCESS',
    paymentId: 'iyz-999',
    fraudStatus: 1,
    conversationId: 'pay-1',
    token: 'tok-xyz',
    cardAssociation: 'MASTER_CARD',
};

describe('IyzicoPaymentService.handleWebhook', () => {
    afterEach(() => jest.restoreAllMocks());

    it('rejects a webhook with an invalid signature (401, nothing touched)', async () => {
        const { client } = buildTestClient([]);
        const ct = makeCTServicesMock();

        const service = makePaymentService(
            { carts: ct.cart, payments: ct.payment },
            client,
        );

        await expect(
            service.handleWebhook(webhookPayload as any, 'deadbeef'),
        ).rejects.toBeInstanceOf(UnauthorizedException);

        expect(ct.payment.findPaymentsByInterfaceId).not.toHaveBeenCalled();
    });

    it('verifies the signature, then finalizes via the SAME retrieve + record path', async () => {
        const { client, captured } = buildTestClient([retrieveOk]);
        const ct = makeCTServicesMock();
        
        jest.spyOn(client, 'verifyWebhookSignature').mockReturnValue(true);

        const payment = makePayment({
            id: 'pay-1',
            transactions: [{ type: 'Charge', state: 'Initial' } as any],
        });

        ct.payment.findPaymentsByInterfaceId.mockResolvedValue([payment]);
        ct.cart.getCartByPaymentId.mockResolvedValue({ id: 'cart-1', lineItems: [] } as any);
        ct.payment.updatePayment.mockResolvedValue(payment);

        const service = makePaymentService(ct, client);

        await service.handleWebhook(webhookPayload as any, 'any-signature');

        expect(ct.payment.findPaymentsByInterfaceId).toHaveBeenCalledWith({ interfaceId: 'tok-xyz' });
        expect(captured[0].url).toBe('/payment/iyzipos/checkoutform/auth/ecom/detail');
        expect(ct.payment.updatePayment).toHaveBeenCalled();
    });

    it('is idempotent: no retrieve/record when the payment already settled', async () => {
        const { client, captured } = buildTestClient([]);   // retrieve must NOT be called

        const finalized = makePayment({
            id: 'pay-1',
            transactions: [{ type: 'Charge', state: 'Success' } as any],
        });

        const ct = makeCTServicesMock();
        ct.payment.findPaymentsByInterfaceId.mockResolvedValue([finalized]);

        const service = makePaymentService(
            { carts: ct.cart, payments: ct.payment },
            client,
        );

        await service.handleWebhook(webhookPayload as any, sign(webhookPayload));

        expect(captured).toHaveLength(0);
        expect(ct.payment.updatePayment).not.toHaveBeenCalled();
    });

    it('ignores a webhook for an unknown token (no throw, no record)', async () => {
        const { client } = buildTestClient([]);

        const ct = makeCTServicesMock();
        ct.payment.findPaymentsByInterfaceId.mockResolvedValue([]);

        const service = makePaymentService(
            { carts: ct.cart, payments: ct.payment },
            client,
        );

        await expect(
            service.handleWebhook(webhookPayload as any, sign(webhookPayload)),
        ).resolves.toBeUndefined();

        expect(ct.payment.updatePayment).not.toHaveBeenCalled();
    });
});