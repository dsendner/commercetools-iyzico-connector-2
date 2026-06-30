/**
 * Standalone CheckoutForm initialize test — hits the REAL Iyzico sandbox.
 *
 * Reuses your actual IyzicoSignatureService (so it tests YOUR signing code),
 * but bypasses commercetools so you can test the Iyzico leg in isolation.
 *
 * Usage:
 *   1. Put IYZICO_BASE_URL / IYZICO_API_KEY / IYZICO_SECRET_KEY in .env
 *   2. npm run iyzico:checkout-form
 *   3. Open the generated checkout-form.html in a browser to see the form,
 *      OR open the printed paymentPageUrl.
 */

import * as dotenv from 'dotenv';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import axios from 'axios';
import { IyzicoSignatureService } from '../iyzico/iyzico-signature.service';
import { IyzicoClient } from '../iyzico/iyzico.client';
import { AppConfigService } from '../config/config.service';
import { IyzicoInitializeResponse } from '../iyzico/converters/iyzico-create-session.converter';

dotenv.config();

const { IYZICO_BASE_URL, IYZICO_API_KEY, IYZICO_SECRET_KEY } = process.env;

if (!IYZICO_BASE_URL || !IYZICO_API_KEY || !IYZICO_SECRET_KEY) {
  console.error('Missing IYZICO_BASE_URL, IYZICO_API_KEY or IYZICO_SECRET_KEY in .env');
  process.exit(1);
}

const config = {
    get: (key: string) => process.env[key]
} as unknown as AppConfigService;

const request = {
  locale: 'tr',
  conversationId: `test-${Date.now()}`,
  price: '1.2',
  paidPrice: '1.2',
  currency: 'TRY',
  basketId: 'B67832',
  paymentGroup: 'PRODUCT',
  callbackUrl: 'https://www.merchant.com/callback',
  enabledInstallments: [1, 2, 3, 6, 9],
  buyer: {
    id: 'BY789',
    name: 'John',
    surname: 'Doe',
    gsmNumber: '+905350000000',
    email: 'email@email.com',
    identityNumber: '74300864791',
    registrationAddress: 'Nidakule Goztepe, Merdivenkoy Mah. Bora Sok. No:1',
    ip: '85.34.78.112',
    city: 'Istanbul',
    country: 'Turkey',
    zipCode: '34732',
  },
  shippingAddress: {
    contactName: 'Jane Doe',
    city: 'Istanbul',
    country: 'Turkey',
    address: 'Nidakule Goztepe, Merdivenkoy Mah. Bora Sok. No:1',
    zipCode: '34742',
  },
  billingAddress: {
    contactName: 'Jane Doe',
    city: 'Istanbul',
    country: 'Turkey',
    address: 'Nidakule Goztepe, Merdivenkoy Mah. Bora Sok. No:1',
    zipCode: '34742',
  },
  basketItems: [
    {
      id: 'BI101',
      name: 'Binocular',
      category1: 'Collectibles',
      itemType: 'PHYSICAL',
      price: '1.2',
    },
  ],
};

const ENDPOINT = '/payment/iyzipos/checkoutform/initialize/auth/ecom';

async function run(): Promise<void> {
  const client = new IyzicoClient(config,new IyzicoSignatureService());
  const sig = new IyzicoSignatureService();
  const bodyStr = JSON.stringify(request);
  const randomKey = sig.generateRandomKey();

  console.log(`POST ${IYZICO_BASE_URL}${ENDPOINT}`);
  const result = await client.post<IyzicoInitializeResponse>(ENDPOINT, request);

  if (result.status.toLocaleLowerCase() !== 'success') {
    console.error('❌ Iyzico returned a failure:');
    console.error(JSON.stringify(result, null, 2));
    process.exit(1);
  }

  console.log('✅ status      :', result.status);
  console.log('   token       :', result.token);
  console.log('   paymentPageUrl:', result.paymentPageUrl);

  // Write an HTML file that embeds the returned form, so you can SEE it.
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Iyzico CheckoutForm test</title></head>
<body>
  <h2>Iyzico CheckoutForm</h2>
  <div id="iyzipay-checkout-form" class="responsive"></div>
  ${result.checkoutFormContent}
</body></html>`;

  const outPath = join(process.cwd(), 'checkout-form.html');
  writeFileSync(outPath, html, 'utf8');
  console.log(`\n📝 Wrote ${outPath} — open it in a browser to see the form.`);
}

run().catch((err: unknown) => {
  if (axios.isAxiosError(err) && err.response) {
    console.error('❌ HTTP', err.response.status, JSON.stringify(err.response.data, null, 2));
  } else if (err instanceof Error) {
    console.error('❌', err.message);
  }
  process.exit(1);
});