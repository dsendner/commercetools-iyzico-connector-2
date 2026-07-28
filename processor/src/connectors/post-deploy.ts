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

    await createCartTokenizationType(sdk);
}


async function createCartTokenizationType(sdk: any): Promise<void> {
  const key = 'iyzico-cart-tokenization';

  const exists = await sdk.ctAPI.customType.existsByKey(key);
  if (exists) {
    console.log(`Cart tokenization type already exists: ${key}`);
    return;
  }

  const type = await sdk.ctAPI.customType.create({
    key,
    name: { en: 'Iyzico cart tokenization' },
    resourceTypeIds: ['order'],
    fieldDefinitions: [{
      name: 'tokenizationRequired',
      type: { name: 'Boolean' },
      label: { en: 'Require card tokenization' },
      required: false,
    }],
  });

  console.log(`Cart tokenization type created: ${type.key}`);
}

run().catch((err) => {
    console.error('Error occurred while running the script:', err);
    process.exit(1);
});
