/**
 * Verifies the complete Iyzico payment and refund journey in the real sandbox.
 *
 * What this browser-free script does:
 *   1. Charges an official public Iyzico sandbox card.
 *   2. Retrieves the payment persisted by Iyzico.
 *   3. Refunds every item transaction individually.
 *   4. Polls Iyzico reporting until the complete refund is visible.
 *
 * Every transactional response is validated against its connector schema,
 * matched to its request and signature-checked before the next step begins.
 *
 * Run:
 *   `npm run iyzico:check-payment-refund -- [price] [currency]`
 *
 * The default amount is 1.2 TRY. This script creates a real sandbox charge and refund.
 */

import { z } from 'zod';

import { iyzicoRefundResponseSchema } from '../iyzico/contracts/refund.schema';
import {
  IyzicoCreatedPayment,
  iyzicoCreatedPaymentResponseSchema,
  iyzicoPaymentDetailResponseSchema,
  IyzicoPaymentReport,
  iyzicoPaymentReportResponseSchema,
  IyzicoRetrievedPayment,
} from '../iyzico/contracts/payment-check.schema';
import {
  buildScriptContext,
  describeError,
  describeValidationIssues,
  fail,
  logCelebration,
  logDetail,
  logHeader,
  logStep,
  logSuccess,
} from './helpers/iyzico-script.helper';

const PAYMENT_ENDPOINT = '/payment/auth';
const PAYMENT_DETAIL_ENDPOINT = '/payment/detail';
const REFUND_ENDPOINT = '/payment/refund';
const REPORTING_ENDPOINT = '/v2/reporting/payment/details';
const REPORTING_ATTEMPTS = 10;
const REPORTING_RETRY_DELAY_MS = 1000;

// Official public sandbox card documented at https://docs.iyzico.com/en/add-ons/test-cards.
const TEST_CARD = {
  cardHolderName: 'John Doe',
  cardNumber: '5526080000000006',
  cvc: '123',
  expireMonth: '12',
  expireYear: '2030',
  registerCard: 0,
};

const argumentsResult = z
  .tuple([z.coerce.number().positive().default(1.2), z.enum(['CHF', 'EUR', 'GBP', 'NOK', 'TRY', 'USD']).default('TRY')])
  .safeParse(process.argv.slice(2));

if (!argumentsResult.success) {
  fail(`Invalid command arguments:\n${describeValidationIssues(argumentsResult.error)}`);
}

const [price, currency] = argumentsResult.data;

interface RefundExpectation {
  conversationId: string;
  currency: string;
  paymentTransactionId: string;
  price: number;
}

function assertEqual(label: string, actual: number | string, expected: number | string): void {
  if (actual !== expected) {
    fail(`${label} does not match. Received ${String(actual)}; expected ${String(expected)}.`);
  }
}

function assertPaymentContents(
  payment: IyzicoCreatedPayment | IyzicoRetrievedPayment,
  expected: {
    basketId: string;
    conversationId: string;
    currency: string;
    paidPrice: number;
    paymentId?: string;
    price: number;
    transactionIds?: string[];
  },
): void {
  assertEqual('conversationId', payment.conversationId, expected.conversationId);
  assertEqual('basketId', payment.basketId, expected.basketId);
  assertEqual('currency', payment.currency, expected.currency);
  assertEqual('price', payment.price, expected.price);
  assertEqual('paidPrice', payment.paidPrice, expected.paidPrice);
  if (expected.paymentId !== undefined) assertEqual('paymentId', payment.paymentId, expected.paymentId);

  if (payment.fraudStatus !== 1) fail(`The payment is not approved. Fraud status: ${payment.fraudStatus}.`);

  const transactionIds = payment.itemTransactions.map(({ paymentTransactionId }) => paymentTransactionId);
  if (new Set(transactionIds).size !== transactionIds.length) {
    fail('Iyzico returned duplicate payment transaction IDs.');
  }

  if (expected.transactionIds !== undefined) {
    assertEqual('item transaction count', transactionIds.length, expected.transactionIds.length);
    for (const transactionId of expected.transactionIds) {
      if (!transactionIds.includes(transactionId)) {
        fail(`The retrieved payment is missing transaction ${transactionId}.`);
      }
    }
  }

  const itemPaidTotal = payment.itemTransactions.reduce((total, item) => total + item.paidPrice, 0);
  assertEqual('item paid total', itemPaidTotal, payment.paidPrice);
}

function assertPaymentSignature(
  client: ReturnType<typeof buildScriptContext>['client'],
  payment: IyzicoCreatedPayment | IyzicoRetrievedPayment,
): void {
  const signed = client.verifyResponseSignature(
    [payment.paymentId, payment.currency, payment.basketId, payment.conversationId, payment.paidPrice, payment.price],
    payment.signature,
  );
  if (!signed) fail('The payment response signature is invalid.');
}

function buildPaymentRequest(conversationId: string) {
  const address = { address: 'Istiklal Cd. 1', city: 'Istanbul', contactName: 'John Doe', country: 'Turkey' };

  return {
    basketId: conversationId,
    basketItems: [
      { category1: 'Payment check', id: 'check-item-1', itemType: 'VIRTUAL', name: 'Payment check item', price },
    ],
    billingAddress: address,
    buyer: {
      city: 'Istanbul',
      country: 'Turkey',
      email: 'payment-check@example.com',
      gsmNumber: '+905350000000',
      id: 'payment-check-buyer-1',
      identityNumber: '74300864791',
      name: 'John',
      registrationAddress: 'Istiklal Cd. 1',
      surname: 'Doe',
    },
    conversationId,
    currency,
    installment: 1,
    locale: 'tr',
    paidPrice: price,
    paymentCard: TEST_CARD,
    paymentChannel: 'WEB',
    paymentGroup: 'PRODUCT',
    price,
    shippingAddress: address,
  };
}

function parseCreatedPayment(raw: unknown): IyzicoCreatedPayment {
  const parsed = iyzicoCreatedPaymentResponseSchema.safeParse(raw);
  if (!parsed.success) {
    fail(`Iyzico returned an invalid payment response:\n${describeValidationIssues(parsed.error)}`);
  }
  if (parsed.data.status === 'failure') {
    fail(`Iyzico declined the payment. [${String(parsed.data.errorCode ?? '-')}] ${parsed.data.errorMessage ?? '-'}`);
  }
  return parsed.data;
}

function parseReport(raw: unknown): IyzicoPaymentReport {
  const parsed = iyzicoPaymentReportResponseSchema.safeParse(raw);
  if (!parsed.success) {
    fail(`Iyzico reporting returned an invalid response:\n${describeValidationIssues(parsed.error)}`);
  }
  if (parsed.data.status === 'failure') {
    fail(
      `Iyzico declined the reporting request. [${String(parsed.data.errorCode ?? '-')}] ${parsed.data.errorMessage ?? '-'}`,
    );
  }
  return parsed.data;
}

function parseRetrievedPayment(raw: unknown): IyzicoRetrievedPayment {
  const parsed = iyzicoPaymentDetailResponseSchema.safeParse(raw);
  if (!parsed.success) {
    fail(`Iyzico returned an invalid payment detail response:\n${describeValidationIssues(parsed.error)}`);
  }
  if (parsed.data.status === 'failure') {
    fail(
      `Iyzico declined the payment detail request. [${String(parsed.data.errorCode ?? '-')}] ${parsed.data.errorMessage ?? '-'}`,
    );
  }
  return parsed.data;
}

function reportContainsRefunds(
  report: IyzicoPaymentReport,
  paymentId: string,
  expectedRefunds: RefundExpectation[],
): boolean {
  const payment = report.payments.find((candidate) => candidate.paymentId === paymentId);
  if (!payment || payment.paymentRefundStatus !== 'TOTALLY_REFUNDED') return false;

  return expectedRefunds.every((expected) => {
    const item = payment.itemTransactions.find(
      (candidate) => candidate.paymentTransactionId === expected.paymentTransactionId,
    );
    return item?.refunds.some(
      (refund) =>
        refund.refundConversationId === expected.conversationId &&
        refund.refundPrice === expected.price &&
        refund.currencyCode === expected.currency &&
        refund.refundStatus === 1,
    );
  });
}

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function run(): Promise<void> {
  const { baseUrl, client, get } = buildScriptContext();
  const conversationId = `payment-refund-check-${Date.now()}`;
  const paymentRequest = buildPaymentRequest(conversationId);

  logHeader('Iyzico Payment & Refund Verification', 'Runs the complete charge-to-refund journey without a browser.');
  logStep('Step 1 of 4 · Charging the official sandbox test card…');
  logDetail('Endpoint', `POST ${baseUrl}${PAYMENT_ENDPOINT}`);
  logDetail('Conversation ID', conversationId);
  logDetail('Charge amount', price, currency);

  const paymentRaw = await client
    .post<unknown>(PAYMENT_ENDPOINT, paymentRequest)
    .catch((error: unknown) => fail(`The payment request did not complete. ${describeError(error)}`));
  const payment = parseCreatedPayment(paymentRaw);

  assertPaymentContents(payment, {
    basketId: paymentRequest.basketId,
    conversationId: paymentRequest.conversationId,
    currency: paymentRequest.currency,
    paidPrice: paymentRequest.paidPrice,
    price: paymentRequest.price,
  });
  assertPaymentSignature(client, payment);
  logSuccess('Sandbox payment created and fully verified.');
  logDetail('Payment ID', payment.paymentId);
  logDetail('Item transactions', payment.itemTransactions.length);
  logDetail('Validated checks', 'Schema · Request match · Totals · Signature');

  const detailConversationId = `${conversationId}-detail`;
  logStep('Step 2 of 4 · Retrieving the payment persisted by Iyzico…');
  logDetail('Endpoint', `POST ${baseUrl}${PAYMENT_DETAIL_ENDPOINT}`);
  logDetail('Conversation ID', detailConversationId);
  const detailRaw = await client
    .post<unknown>(PAYMENT_DETAIL_ENDPOINT, {
      conversationId: detailConversationId,
      locale: 'tr',
      paymentId: payment.paymentId,
    })
    .catch((error: unknown) => fail(`The payment detail request did not complete. ${describeError(error)}`));
  const detail = parseRetrievedPayment(detailRaw);

  if (detail.paymentStatus !== 'SUCCESS') {
    fail(`The retrieved payment is not successful. Payment status: ${detail.paymentStatus}.`);
  }

  assertPaymentContents(detail, {
    basketId: payment.basketId,
    conversationId: detailConversationId,
    currency: payment.currency,
    paidPrice: payment.paidPrice,
    paymentId: payment.paymentId,
    price: payment.price,
    transactionIds: payment.itemTransactions.map(({ paymentTransactionId }) => paymentTransactionId),
  });
  assertPaymentSignature(client, detail);
  logSuccess('Persisted payment retrieved and fully verified.');
  logDetail('Payment status', detail.paymentStatus);
  logDetail('Validated checks', 'Identity · State · Items · Totals · Signature');

  const expectedRefunds: RefundExpectation[] = [];
  logStep(`Step 3 of 4 · Refunding ${detail.itemTransactions.length} item transaction(s)…`);
  for (const item of detail.itemTransactions) {
    const request = {
      conversationId: `${conversationId}-refund-${item.itemId}`,
      currency,
      locale: 'tr',
      paymentTransactionId: item.paymentTransactionId,
      price: item.paidPrice,
    };
    expectedRefunds.push(request);

    logDetail(
      'Refunding item',
      `${item.itemId} · Transaction ${item.paymentTransactionId} · ${item.paidPrice} ${currency}`,
    );
    const raw = await client
      .post<unknown>(REFUND_ENDPOINT, request)
      .catch((error: unknown) => fail(`The refund request did not complete. ${describeError(error)}`));
    const parsed = iyzicoRefundResponseSchema.safeParse(raw);
    if (!parsed.success) {
      fail(`Iyzico returned an invalid refund response:\n${describeValidationIssues(parsed.error)}`);
    }

    const refund = parsed.data;
    if (refund.status === 'failure') {
      fail(`Iyzico declined the refund. [${refund.errorCode ?? '-'}] ${refund.errorMessage ?? '-'}`);
    }

    assertEqual('refund paymentId', refund.paymentId, payment.paymentId);
    assertEqual('refund conversationId', refund.conversationId, request.conversationId);
    assertEqual('refund currency', refund.currency, request.currency);
    assertEqual('refund paymentTransactionId', refund.paymentTransactionId, request.paymentTransactionId);
    assertEqual('refund price', refund.price, request.price);

    if (
      !client.verifyResponseSignature(
        [refund.paymentId, refund.price, refund.currency, refund.conversationId],
        refund.signature,
      )
    ) {
      fail('The refund response signature is invalid.');
    }

    logSuccess(`Refund accepted and verified for item ${item.itemId}.`);
  }

  const reportConversationId = `${conversationId}-report`;
  logStep('Step 4 of 4 · Waiting for every refund to appear in Iyzico reporting…');
  logDetail('Endpoint', `GET ${baseUrl}${REPORTING_ENDPOINT}`);
  logDetail('Maximum attempts', REPORTING_ATTEMPTS);
  for (let attempt = 1; attempt <= REPORTING_ATTEMPTS; attempt += 1) {
    const raw = await get<unknown>(REPORTING_ENDPOINT, {
      conversationId: reportConversationId,
      locale: 'tr',
      paymentId: payment.paymentId,
    }).catch((error: unknown) => fail(`The reporting request did not complete. ${describeError(error)}`));
    const report = parseReport(raw);

    if (report.conversationId !== undefined) {
      assertEqual('report conversationId', report.conversationId, reportConversationId);
    }
    if (reportContainsRefunds(report, payment.paymentId, expectedRefunds)) {
      logSuccess('Iyzico reporting confirms that the payment is fully refunded and every item refund is recorded.');
      logCelebration('Payment creation, persistence and complete refund verified successfully in the Iyzico sandbox.');
      return;
    }

    if (attempt < REPORTING_ATTEMPTS) {
      logDetail('Reporting status', `Refunds not visible yet · Attempt ${attempt}/${REPORTING_ATTEMPTS}`);
      await wait(REPORTING_RETRY_DELAY_MS);
    }
  }

  fail(`Iyzico reporting did not confirm every refund after ${REPORTING_ATTEMPTS} attempts.`);
}

run().catch((error: unknown) => fail(`Unexpected payment and refund verification failure. ${describeError(error)}`));
