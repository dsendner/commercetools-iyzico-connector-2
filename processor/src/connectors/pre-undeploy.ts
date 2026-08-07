import { setupPaymentSDK, RequestContextData } from '@commercetools/connect-payments-sdk';
import * as dotenv from 'dotenv';

dotenv.config();

async function preUndeploy(): Promise<void> {
    const emptyContext: RequestContextData = { correlationId: '', requestId: '', authentication: undefined };

    const sdk = setupPaymentSDK({
        apiUrl: process.env.CTP_API_URL as string,
        authUrl: process.env.CTP_AUTH_URL as string,
        sessionUrl: process.env.CTP_SESSION_URL as string,
        checkoutUrl: process.env.CTP_CHECKOUT_URL as string,
        jwksUrl: process.env.CTP_JWKS_URL as string,
        clientId: process.env.CTP_CLIENT_ID as string,
        clientSecret: process.env.CTP_CLIENT_SECRET as string,
        projectKey: process.env.CTP_PROJECT_KEY as string,
        jwtIssuer: process.env.CTP_JWT_ISSUER as string,
        getContextFn: () => emptyContext,
        updateContextFn: () => undefined,
    });

    await deleteCustomTypeIfExists(sdk, 'iyzico-payment-card-info');
}

async function deleteCustomTypeIfExists(sdk: any, key: string): Promise<void> {
    try {
        if (!(await sdk.ctAPI.customType.existsByKey(key))) {
            console.log(`Custom type does not exist, skipping: ${key}`);
            return;
        }

        const existing = await sdk.ctAPI.customType.getByKey(key);

        await sdk.ctAPI.customType.delete({ id: existing.id, version: existing.version });

        console.log(`Custom type deleted: ${key}`);
    } catch (err: any) {
        console.warn(`Could not delete custom type "${key}": ${err.message ?? err}`);
    }
}

preUndeploy()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error('preUndeploy failed:', err);
        process.exit(1);
    });