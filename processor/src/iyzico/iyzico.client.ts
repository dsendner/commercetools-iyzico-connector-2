import { Injectable, Logger } from "@nestjs/common";
import axios, { AxiosInstance, AxiosResponse, InternalAxiosRequestConfig } from "axios";
import { AppConfigService } from "../config/config.service";
import { IyzicoSignatureService } from "./iyzico-signature.service";
import { IyzicoWebhookPayload } from "./converters/webhook.converter";

@Injectable()
export class IyzicoClient {
    private readonly logger = new Logger(IyzicoClient.name);
    private readonly client: AxiosInstance;

    constructor(
        private readonly config: AppConfigService,
        private readonly authSignature: IyzicoSignatureService
    ) {
        this.client = axios.create({
            baseURL: this.config.get('IYZICO_BASE_URL'),
            timeout: this.config.get('IYZICO_TIMEOUT'),
            headers: {
                'Content-Type': 'application/json',
            },
        });

        this.client.interceptors.request.use((request) => this.signRequest(request));
    }

    async post<T>(path: string, data: any): Promise<T> {
        this.logger.log(`Sending POST request to Iyzico: ${path} with data: ${JSON.stringify(data)}`);
        const response: AxiosResponse<T> = await this.client.post(path, data);
        this.logger.log(`Received response from Iyzico: ${JSON.stringify(response.data)}`);
        return response.data;
    }

    signRequest(request: InternalAxiosRequestConfig): InternalAxiosRequestConfig {
        const body = JSON.stringify(request.data);
        const path = request.url || '';

        const headers = {
            'Content-Type': 'application/json',
            ...this.authSignature.buildAuthHeader(
                this.config.get('IYZICO_API_KEY'),
                this.config.get('IYZICO_SECRET_KEY'),
                path,
                body,
            ),
        };
        request.headers.setAuthorization(headers.Authorization);
        request.headers.set('x-iyzi-rnd', headers['x-iyzi-rnd']);
        return request;
    }

    verifyWebhookSignature(payload: IyzicoWebhookPayload, signature: string) {
        return this.authSignature.verifyWebhookSignature(
            this.config.get('IYZICO_SECRET_KEY'),
            payload,
            signature,
        )
    }
}
