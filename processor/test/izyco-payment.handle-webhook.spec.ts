import { createHmac } from 'crypto';
import { UnauthorizedException } from '@nestjs/common';
import type { Payment } from '@commercetools/platform-sdk';
import { buildTestClient, TEST_SECRET } from './helpers/test-client';
import { makeCt, makePaymentService, money } from './helpers/ct-client-mock';


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
        const ct = makeCt();

        await expect(
            makePaymentService(ct, client).handleWebhook(webhookPayload, 'deadbeef'),
        ).rejects.toBeInstanceOf(UnauthorizedException);
        expect(ct.payments.findPaymentsByInterfaceId).not.toHaveBeenCalled();
    });

    it('verifies the signature, then finalizes via the SAME retrieve + record path', async () => {
        const { client, captured } = buildTestClient([retrieveOk]);
        const ct = makeCt();

        await makePaymentService(ct, client).handleWebhook(webhookPayload, sign(webhookPayload));

        expect(ct.payments.findPaymentsByInterfaceId).toHaveBeenCalledWith({ interfaceId: 'tok-xyz' });
        expect(captured[0].url).toBe('/payment/iyzipos/checkoutform/auth/ecom/detail');
        expect(ct.payments.updatePayment).toHaveBeenCalled();
    });

    it('is idempotent: no retrieve/record when the payment already settled', async () => {
        const { client, captured } = buildTestClient([]); // retrieve must NOT be called
        const finalized = {
            id: 'pay-1',
            amountPlanned: money(4990),
            interfaceId: 'tok-xyz',
            transactions: [{ type: 'Charge', state: 'Success' }],
        } as unknown as Payment;

        const ct = makeCt({
            payments: { findPaymentsByInterfaceId: jest.fn().mockResolvedValue([finalized]) },
        });

        await makePaymentService(ct, client).handleWebhook(webhookPayload, sign(webhookPayload));

        expect(captured).toHaveLength(0);
        expect(ct.payments.updatePayment).not.toHaveBeenCalled();

    });

    it('ignores a webhook for an unknown token (no throw, no record)', async () => {
        const { client } = buildTestClient([]);
        const ct = makeCt({
            payments: { findPaymentsByInterfaceId: jest.fn().mockResolvedValue([]) },

        });

        await expect(
            makePaymentService(ct, client).handleWebhook(webhookPayload, sign(webhookPayload)),
        ).resolves.toBeUndefined();

        expect(ct.payments.updatePayment).not.toHaveBeenCalled();
    });
});

