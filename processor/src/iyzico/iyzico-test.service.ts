import { Injectable } from '@nestjs/common';
import { IyzicoSignatureService } from './iyzico-signature.service';
import axios from 'axios';

@Injectable()
export class IyzicoTestService {
    constructor(
        private readonly signatureService: IyzicoSignatureService,
    ) { }

    async pingSandbox() {
        const path = '/payment/bin/check';

        const bodyObject = {
            locale: 'en',
            binNumber: '41579200',
            conversationId: 'test-123',
        };

        const body = JSON.stringify(bodyObject);

        const headers = {
            'Content-Type': 'application/json',
            ...this.signatureService.buildAuthHeader(
                process.env.IYZICO_API_KEY!,
                process.env.IYZICO_SECRET_KEY!,
                path,
                body,
            ),
        };

        console.log('Requesting Iyzico Sandbox with headers:', headers);
        console.log('Request body:', body);

        const response = await axios.post(
            `https://sandbox-api.iyzipay.com${path}`,
            body,
            { headers },
        );
        console.log('Received response from Iyzico Sandbox:', response.data);
        return response.data;
    }
}
