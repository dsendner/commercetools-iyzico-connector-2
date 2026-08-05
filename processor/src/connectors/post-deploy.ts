import { RequestContextData, setupPaymentSDK } from '@commercetools/connect-payments-sdk';
import * as dotenv from 'dotenv';


dotenv.config();

async function run(): Promise<void> {
    const emptyContext: RequestContextData = {correlationId: '', requestId: '', authentication: undefined};

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
        getContextFn:() => emptyContext,
        updateContextFn:() => undefined
    });

    const type = await sdk.ctCustomTypeService.createOrUpdatePredefinedInterfaceInteractionType();
    console.log(`predefined interface interaction type created/updated: ${type.key}`);

    await createPaymentCardType(sdk);

}

async function createPaymentCardType(sdk: any): Promise<void> {
  const key = 'iyzico-payment-card-info';

  if (await sdk.ctAPI.customType.existsByKey(key)) {
    console.log(`Custom type already exists: ${key}`);
    return;
  }

  const type = await sdk.ctAPI.customType.create({
    key,
    name: { en: 'Iyzico payment card info' },
    resourceTypeIds: ['payment'],
    fieldDefinitions: [
      { name: 'cardType',        type: { name: 'String' }, label: { en: 'Card type' },        required: false },
      { name: 'cardAssociation', type: { name: 'String' }, label: { en: 'Card association' }, required: false },
      { name: 'cardFamily',      type: { name: 'String' }, label: { en: 'Card family' },      required: false },
      { name: 'binNumber',       type: { name: 'String' }, label: { en: 'BIN' },              required: false },
      { name: 'lastFourDigits',  type: { name: 'String' }, label: { en: 'Last four digits' }, required: false },
    ],
  });

  console.log(`Custom type created: ${type.key}`);
}

run().catch((err) => {
    console.error('Error occurred while running the script:', err);
    process.exit(1);
});
