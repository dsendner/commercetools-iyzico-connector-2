import * as dotenv from 'dotenv';
import { IyzicoSignatureService } from '../iyzico/iyzico-signature.service';
import { IyzicoClient } from '../iyzico/iyzico.client';
import { AppConfigService } from '../config/config.service';
import { IyzicoRetrieveResponse } from '../iyzico/converters/iyzico-retrieve-payment.converter';

dotenv.config();

const { IYZICO_BASE_URL, IYZICO_API_KEY, IYZICO_SECRET_KEY } = process.env;

if (!IYZICO_BASE_URL || !IYZICO_API_KEY || !IYZICO_SECRET_KEY) {
    console.error('Missing IYZICO_BASE_URL, IYZICO_API_KEY or IYZICO_SECRET_KEY in .env');
    process.exit(1);
}



const token = process.argv[2];

if (!token) {

    console.error('Usage: npm run iyzico:retrieve -- <token>');

    console.error('  <token> is what Iyzico posted to your callbackUrl after payment (Step 3).');

    process.exit(1);

}



// Minimal config the client needs — only the IYZICO_* keys (no commercetools).

const config = {

    get: (key: string) =>

        key === 'IYZICO_TIMEOUT_MS' ? Number(process.env.IYZICO_TIMEOUT_MS ?? 10000) : process.env[key],

} as unknown as AppConfigService;



const ENDPOINT = '/payment/iyzipos/checkoutform/auth/ecom/detail';



async function run(): Promise<void> {

    const client = new IyzicoClient(config, new IyzicoSignatureService());



    console.log(`POST ${IYZICO_BASE_URL}${ENDPOINT}`);

    // The client verifies the response signature automatically (anti-tamper).

    const result = await client.post<IyzicoRetrieveResponse>(ENDPOINT, { locale: 'tr', token });



    if (result.status.toLocaleLowerCase() !== 'success') {

        console.error('❌ Iyzico returned a failure:');

        console.error(`   errorCode    : ${result.errorCode}`);

        console.error(`   errorMessage : ${result.errorMessage}`);

        process.exit(1);

    }



    console.log("everything : ", result);
    console.log('✅ status        :', result.status);

    console.log('   paymentStatus :', result.paymentStatus);

    console.log('   paymentId     :', result.paymentId);

    console.log('   fraudStatus   :', result.fraudStatus, '(1 approved, 0 review, -1 rejected)');

    console.log('   price / paid  :', result.price, '/', result.paidPrice, result.currency);

    console.log('   card          :', result.cardAssociation, '••••', result.lastFourDigits ?? '');

    console.log('   installment   :', result.installment);

}



run().catch((err: unknown) => {

    console.error('❌', err instanceof Error ? err.message : err);

    process.exit(1);

});