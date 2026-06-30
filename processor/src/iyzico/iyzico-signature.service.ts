import { Injectable } from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { IyzicoWebhookPayload } from './converters/webhook.converter';

@Injectable()
export class IyzicoSignatureService {
    generateRandomKey(): string {
        return randomBytes(16).toString('hex');
    }

    computeSignature(
        secretKey: string,
        randomKey: string,
        path: string,
        body = '',
    ): string {
        const payload = randomKey + path + body;

        return createHmac('sha256', secretKey)
            .update(payload, 'utf8')
            .digest('hex');
    }

    buildAuthHeader(
        apiKey: string,
        secretKey: string,
        path: string,
        body = '',
    ) {
        const randomKey = this.generateRandomKey();

        const signature = this.computeSignature(
            secretKey,
            randomKey,
            path,
            body,
        );

        const authorizationString =
            `apiKey:${apiKey}` +
            `&randomKey:${randomKey}` +
            `&signature:${signature}`;

        return {
            Authorization: `IYZWSv2 ${Buffer.from(
                authorizationString,
            ).toString('base64')}`,
            'x-iyzi-rnd': randomKey,
        };
    }

    verifyWebhookSignature(secretKey: string, payload: IyzicoWebhookPayload, signature: string | undefined): boolean {
        const computedSignature = this.computeWebhookSignature(
            secretKey,
            payload
        );
        const computed = Buffer.from(computedSignature, 'utf8');
        const expected = Buffer.from(signature ?? '', 'utf8');
        return computed.length === expected.length && timingSafeEqual(computed, expected);
    }

    private computeWebhookSignature(secretKey: string, payload: IyzicoWebhookPayload) {
        const fieldsToValid = 
        secretKey +
        payload.iyziEventType +
        payload.iyziPaymentId +
        payload.token +
        payload.paymentConversationId +
        payload.status;
        return createHmac('sha256', secretKey)
            .update(fieldsToValid, 'utf8')
            .digest('hex');

    }
}