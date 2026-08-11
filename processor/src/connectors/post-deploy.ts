import { RequestContextData, setupPaymentSDK } from '@commercetools/connect-payments-sdk';
import * as dotenv from 'dotenv';


dotenv.config();

async function run(): Promise<void> {
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
        updateContextFn: () => undefined
    });

    const type = await sdk.ctCustomTypeService.createOrUpdatePredefinedInterfaceInteractionType();
    console.log(`predefined interface interaction type created/updated: ${type.key}`);

    await ensurePaymentType(sdk);
    await ensurePaymentMethodType(sdk);

}

async function ensurePaymentType(sdk: any): Promise<void> {
    const key = 'iyzico-payment';

    const expected = [
        { name: 'cardType',        type: { name: 'String' }, label: { en: 'Card type' },           required: false },
        { name: 'cardAssociation', type: { name: 'String' }, label: { en: 'Card association' },    required: false },
        { name: 'cardFamily',      type: { name: 'String' }, label: { en: 'Card family' },         required: false },
        { name: 'binNumber',       type: { name: 'String' }, label: { en: 'BIN' },                 required: false },
        { name: 'lastFourDigits',  type: { name: 'String' }, label: { en: 'Last four digits' },    required: false },
        { name: 'cardId',          type: { name: 'String' }, label: { en: 'Stored PaymentMethod ID' }, required: false },
        { name: 'installments',    type: { name: 'Number' }, label: { en: 'Installments' },           required: false },
        { name: 'conversationId',    type: { name: 'String' }, label: { en: 'Tracking Iyzico Conversation ID' }, required: false }
    ];

    await createOrUpdate(sdk, {
        key,
        name: { en: 'Iyzico payment details' },
        resourceTypeIds: ['payment'],
        expected,
    });
}

async function ensurePaymentMethodType(sdk: any): Promise<void> {
    const key = 'iyzico-payment-method';

    const expected = [
        { name: 'brand', type: { name: 'String' }, label: { en: 'Card brand' }, required: false },
        { name: 'lastFour', type: { name: 'String' }, label: { en: 'Last four' }, required: false },
        { name: 'bin', type: { name: 'String' }, label: { en: 'BIN' }, required: false },
        { name: 'expiryMonth', type: { name: 'Number' }, label: { en: 'Expiry month' }, required: false },
        { name: 'expiryYear', type: { name: 'Number' }, label: { en: 'Expiry year' }, required: false },
    ];

    await createOrUpdate(sdk, {
        key,
        name: { en: 'Iyzico stored card details' },
        resourceTypeIds: ['payment-method'],
        expected,
    });
}


async function createOrUpdate(
    sdk: any,
    { key, name, resourceTypeIds, expected }: {
        key: string;
        name: { en: string };
        resourceTypeIds: string[];
        expected: any[];
    },
): Promise<void> {
    if (!(await sdk.ctAPI.customType.existsByKey(key))) {
        await sdk.ctAPI.customType.create({
            key,
            name,
            resourceTypeIds,
            fieldDefinitions: expected,
        });
        console.log(`Custom type created: ${key}`);
        return;
    }

    const existing = await sdk.ctAPI.customType.getByKey(key);
    const known = new Set(existing.fieldDefinitions.map((f: any) => f.name));
    const missing = expected.filter(f => !known.has(f.name));

    if (missing.length === 0) {
        console.log(`Custom type up to date: ${key}`);
        return;
    }

    await sdk.ctAPI.customType.update({
        id: existing.id,
        version: existing.version,
        actions: missing.map(fieldDefinition => ({ action: 'addFieldDefinition', fieldDefinition })),
    });

    console.log(`Custom type updated: ${key} — added ${missing.map(f => f.name).join(', ')}`);
}

run().catch((err) => {
    console.error('Error occurred while running the script:', err);
    process.exit(1);
});
