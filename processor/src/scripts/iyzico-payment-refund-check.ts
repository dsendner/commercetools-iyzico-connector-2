/**
 * Verifies the complete Iyzico payment and refund journey in the real sandbox.
 *
 * What this browser-free script does:
 *   1. Charges an official public Iyzico sandbox card for a multi-line basket.
 *   2. Retrieves the payment persisted by Iyzico.
 *   3. Refunds every item transaction individually.
 *   4. Polls Iyzico reporting until the complete refund is visible.
 *   5. Replays one refund and requires Iyzico to refuse it.
 *   6. Refunds an unknown transaction and requires Iyzico to refuse it.
 *   7. Retrieves an unknown payment and requires Iyzico to refuse it.
 *   8. Tampers a genuine response signature and requires the connector to reject it.
 *   9. Charges a documented declining card and requires Iyzico to report it as failed.
 *
 * The basket carries several lines on purpose. A commercetools refund maps to one
 * Iyzico call per basket line, so a single-line basket would never exercise the
 * fan-out the connector actually performs in production.
 *
 * Every transactional response is validated against its connector schema,
 * matched to its request and signature-checked before the next step begins.
 *
 * Run:
 *   `npm run iyzico:check-payment-refund -- [totalPrice] [currency] [itemCount]`
 *
 * Defaults to 12 TRY spread over 10 basket lines. This script creates a real
 * sandbox charge and refund.
 */

import { z } from 'zod';

import {
  iyzicoRefundResponseSchema,
  IyzicoRefundResponse,
} from '../iyzico/contracts/refund.schema';
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

const TOTAL_STEPS = 9;
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

// Documented decliner at https://docs.iyzico.com/en/add-ons/test-cards, "Not sufficient funds".
const DECLINING_TEST_CARD = {
  cardHolderName: 'John Doe',
  cardNumber: '4111111111111129',
  cvc: '123',
  expireMonth: '12',
  expireYear: '2030',
  registerCard: 0,
};

const argumentsResult = z
  .tuple([
    z.coerce.number().positive().default(12),
    z.enum(['CHF', 'EUR', 'GBP', 'NOK', 'TRY', 'USD']).default('TRY'),
    z.coerce.number().int().min(1).max(50).default(10),
  ])
  .safeParse(process.argv.slice(2));

if (!argumentsResult.success) {
  fail(
    `Invalid command arguments:\n${describeValidationIssues(argumentsResult.error)}`,
  );
}

const [price, currency, itemCount] = argumentsResult.data;

/**
 * Splits the total across the basket lines in minor units so the lines always add up
 * to the exact total. Iyzico rejects a basket whose lines do not sum to the price.
 */
function splitPrice(total: number, count: number): number[] {
  const totalMinorUnits = Math.round(total * 100);
  if (totalMinorUnits < count) {
    fail(
      `A total of ${total} ${currency} cannot be split across ${count} basket lines.`,
    );
  }

  const baseMinorUnits = Math.floor(totalMinorUnits / count);
  const linesTakingAnExtraUnit = totalMinorUnits - baseMinorUnits * count;

  return Array.from(
    { length: count },
    (_, index) =>
      (baseMinorUnits + (index < linesTakingAnExtraUnit ? 1 : 0)) / 100,
  );
}

const itemPrices = splitPrice(price, itemCount);

interface RefundExpectation {
  conversationId: string;
  currency: string;
  paymentTransactionId: string;
  price: number;
}

function assertEqual(
  label: string,
  actual: number | string,
  expected: number | string,
): void {
  if (actual !== expected) {
    fail(
      `${label} does not match. Received ${String(actual)}; expected ${String(expected)}.`,
    );
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
  assertEqual(
    'conversationId',
    payment.conversationId,
    expected.conversationId,
  );
  assertEqual('basketId', payment.basketId, expected.basketId);
  assertEqual('currency', payment.currency, expected.currency);
  assertEqual('price', payment.price, expected.price);
  assertEqual('paidPrice', payment.paidPrice, expected.paidPrice);
  if (expected.paymentId !== undefined)
    assertEqual('paymentId', payment.paymentId, expected.paymentId);

  if (payment.fraudStatus !== 1)
    fail(`The payment is not approved. Fraud status: ${payment.fraudStatus}.`);

  const transactionIds = payment.itemTransactions.map(
    ({ paymentTransactionId }) => paymentTransactionId,
  );
  if (new Set(transactionIds).size !== transactionIds.length) {
    fail('Iyzico returned duplicate payment transaction IDs.');
  }

  if (expected.transactionIds !== undefined) {
    assertEqual(
      'item transaction count',
      transactionIds.length,
      expected.transactionIds.length,
    );
    for (const transactionId of expected.transactionIds) {
      if (!transactionIds.includes(transactionId)) {
        fail(`The retrieved payment is missing transaction ${transactionId}.`);
      }
    }
  }

  // Summed in minor units: adding several decimal amounts as floating point numbers
  // drifts, and a ten line basket of 1.2 would otherwise total 11.999999999999998.
  const itemPaidTotalMinorUnits = payment.itemTransactions.reduce(
    (total, item) => total + Math.round(item.paidPrice * 100),
    0,
  );
  assertEqual(
    'item paid total',
    itemPaidTotalMinorUnits,
    Math.round(payment.paidPrice * 100),
  );
}

function assertPaymentSignature(
  client: ReturnType<typeof buildScriptContext>['client'],
  payment: IyzicoCreatedPayment | IyzicoRetrievedPayment,
): void {
  const signed = client.verifyResponseSignature(
    [
      payment.paymentId,
      payment.currency,
      payment.basketId,
      payment.conversationId,
      payment.paidPrice,
      payment.price,
    ],
    payment.signature,
  );
  if (!signed) fail('The payment response signature is invalid.');
}

function buildPaymentRequest(
  conversationId: string,
  card: typeof TEST_CARD = TEST_CARD,
) {
  const address = {
    address: 'Istiklal Cd. 1',
    city: 'Istanbul',
    contactName: 'John Doe',
    country: 'Turkey',
  };

  return {
    basketId: conversationId,
    basketItems: itemPrices.map((itemPrice, index) => ({
      category1: 'Payment check',
      id: `check-item-${index + 1}`,
      itemType: 'VIRTUAL',
      name: `Payment check item ${index + 1}`,
      price: itemPrice,
    })),
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
    paymentCard: card,
    paymentChannel: 'WEB',
    paymentGroup: 'PRODUCT',
    price,
    shippingAddress: address,
  };
}

function parseCreatedPayment(raw: unknown): IyzicoCreatedPayment {
  const parsed = iyzicoCreatedPaymentResponseSchema.safeParse(raw);
  if (!parsed.success) {
    fail(
      `Iyzico returned an invalid payment response:\n${describeValidationIssues(parsed.error)}`,
    );
  }
  if (parsed.data.status === 'failure') {
    fail(
      `Iyzico declined the payment. [${String(parsed.data.errorCode ?? '-')}] ${parsed.data.errorMessage ?? '-'}`,
    );
  }
  return parsed.data;
}

function parseReport(raw: unknown): IyzicoPaymentReport {
  const parsed = iyzicoPaymentReportResponseSchema.safeParse(raw);
  if (!parsed.success) {
    fail(
      `Iyzico reporting returned an invalid response:\n${describeValidationIssues(parsed.error)}`,
    );
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
    fail(
      `Iyzico returned an invalid payment detail response:\n${describeValidationIssues(parsed.error)}`,
    );
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
  const payment = report.payments.find(
    (candidate) => candidate.paymentId === paymentId,
  );
  if (!payment || payment.paymentRefundStatus !== 'TOTALLY_REFUNDED')
    return false;

  return expectedRefunds.every((expected) => {
    const item = payment.itemTransactions.find(
      (candidate) =>
        candidate.paymentTransactionId === expected.paymentTransactionId,
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

/**
 * Refunds an item that was already refunded, and requires Iyzico to reject it.
 *
 * This is the safety net the connector relies on. Its resume logic skips items it has
 * already refunded, so a customer is never paid twice; this step proves that Iyzico
 * would refuse anyway, and that the failure branch of the response contract accepts a
 * genuine rejection rather than only the fixtures used in the unit tests.
 */
async function verifyRepeatedRefundIsRejected(
  client: ReturnType<typeof buildScriptContext>['client'],
  item: IyzicoRetrievedPayment['itemTransactions'][number],
  conversationId: string,
): Promise<void> {
  logStep(
    `Step 5 of ${TOTAL_STEPS} · Confirming that a repeated refund is refused…`,
  );
  logDetail(
    'Replaying item',
    `${item.itemId} · Transaction ${item.paymentTransactionId}`,
  );

  const request = {
    conversationId: `${conversationId}-refund-replay-${item.itemId}`,
    currency,
    locale: 'tr',
    paymentTransactionId: item.paymentTransactionId,
    price: item.paidPrice,
  };
  const raw = await client
    .post<unknown>(REFUND_ENDPOINT, request)
    .catch((error: unknown) =>
      fail(
        `The repeated refund request did not complete. ${describeError(error)}`,
      ),
    );

  const parsed = iyzicoRefundResponseSchema.safeParse(raw);
  if (!parsed.success) {
    fail(
      `Iyzico returned a rejection that does not match the response contract:\n${describeValidationIssues(parsed.error)}`,
    );
  }
  if (parsed.data.status === 'success') {
    fail(
      `Iyzico refunded item ${item.itemId} a second time. The amount was paid back twice.`,
    );
  }

  assertEqual(
    'rejected refund conversationId',
    parsed.data.conversationId ?? '',
    request.conversationId,
  );
  logSuccess(
    'Iyzico refused the repeated refund, and the rejection matches the response contract.',
  );
  logDetail('Error code', parsed.data.errorCode ?? '-');
  logDetail('Retryable', String(parsed.data.retryable ?? '-'));
}

/**
 * Refunds a transaction id Iyzico has never seen, and requires it to reject the request.
 *
 * The only Iyzico refund failure exercised so far is "already refunded". An unknown
 * transaction id is a different failure at Iyzico's end and must land on the same
 * failure branch of the response contract.
 */
async function verifyUnknownTransactionIsRejected(
  client: ReturnType<typeof buildScriptContext>['client'],
  conversationId: string,
): Promise<void> {
  logStep(
    `Step 6 of ${TOTAL_STEPS} · Confirming that refunding an unknown transaction is refused…`,
  );

  const request = {
    conversationId: `${conversationId}-refund-unknown`,
    currency,
    locale: 'tr',
    paymentTransactionId: '0',
    price: '1.00',
  };
  const raw = await client
    .post<unknown>(REFUND_ENDPOINT, request)
    .catch((error: unknown) =>
      fail(
        `The unknown transaction refund request did not complete. ${describeError(error)}`,
      ),
    );

  const parsed = iyzicoRefundResponseSchema.safeParse(raw);
  if (!parsed.success) {
    fail(
      `Iyzico returned a rejection that does not match the response contract:\n${describeValidationIssues(parsed.error)}`,
    );
  }
  if (parsed.data.status === 'success') {
    fail('Iyzico refunded a transaction id it was never given.');
  }

  logSuccess(
    'Iyzico refused the unknown transaction, and the rejection matches the response contract.',
  );
  logDetail('Error code', parsed.data.errorCode ?? '-');
}

/**
 * Retrieves a payment id Iyzico has never seen, and requires it to reject the request.
 *
 * `/payment/detail` has so far only ever been exercised on a payment that genuinely
 * exists. Its failure branch, used every time a stale or mistyped payment id is looked
 * up in production, has never been checked against a real response.
 */
async function verifyUnknownPaymentIsRejected(
  client: ReturnType<typeof buildScriptContext>['client'],
  conversationId: string,
): Promise<void> {
  logStep(
    `Step 7 of ${TOTAL_STEPS} · Confirming that retrieving an unknown payment is refused…`,
  );

  const raw = await client
    .post<unknown>(PAYMENT_DETAIL_ENDPOINT, {
      conversationId: `${conversationId}-detail-unknown`,
      locale: 'tr',
      paymentId: '0',
    })
    .catch((error: unknown) =>
      fail(
        `The unknown payment detail request did not complete. ${describeError(error)}`,
      ),
    );

  const parsed = iyzicoPaymentDetailResponseSchema.safeParse(raw);
  if (!parsed.success) {
    fail(
      `Iyzico returned a rejection that does not match the response contract:\n${describeValidationIssues(parsed.error)}`,
    );
  }
  if (parsed.data.status === 'success') {
    fail('Iyzico returned details for a payment id it was never given.');
  }

  logSuccess(
    'Iyzico refused the unknown payment, and the rejection matches the response contract.',
  );
  logDetail('Error code', parsed.data.errorCode ?? '-');
}

/**
 * Tampers a genuine, previously verified refund response and requires the connector's
 * own signature check to reject it.
 *
 * Every other step proves the connector accepts a real Iyzico response. This is the
 * one step that proves it also rejects a response it should not trust, using a real
 * payload rather than a fixture invented for a unit test.
 */
function verifyTamperedSignatureIsRejected(
  client: ReturnType<typeof buildScriptContext>['client'],
  refund: IyzicoRefundResponse & { status: 'success' },
): void {
  logStep(
    `Step 8 of ${TOTAL_STEPS} · Confirming that a tampered signature is rejected…`,
  );

  const tamperedSignature =
    refund.signature.slice(0, -1) +
    (refund.signature.endsWith('0') ? '1' : '0');
  const signed = client.verifyResponseSignature(
    [refund.paymentId, refund.price, refund.currency, refund.conversationId],
    tamperedSignature,
  );
  if (signed)
    fail('The connector accepted a refund response with a tampered signature.');

  logSuccess(
    'The connector rejected the tampered signature, using a genuine refund response.',
  );
}

/**
 * Charges a documented declining test card and requires Iyzico to report the failure,
 * rather than a success with a suspicious fraud status.
 *
 * Every payment exercised so far succeeds. The failure branch of the payment creation
 * contract, used whenever a real customer's card is declined, has never been checked
 * against a real response.
 */
async function verifyDecliningCardIsRejected(
  client: ReturnType<typeof buildScriptContext>['client'],
): Promise<void> {
  logStep(`Step 9 of ${TOTAL_STEPS} · Charging a documented declining card…`);

  const conversationId = `payment-refund-check-decline-${Date.now()}`;
  const request = buildPaymentRequest(conversationId, DECLINING_TEST_CARD);
  const raw = await client
    .post<unknown>(PAYMENT_ENDPOINT, request)
    .catch((error: unknown) =>
      fail(
        `The declining card request did not complete. ${describeError(error)}`,
      ),
    );

  const parsed = iyzicoCreatedPaymentResponseSchema.safeParse(raw);
  if (!parsed.success) {
    fail(
      `Iyzico returned a rejection that does not match the response contract:\n${describeValidationIssues(parsed.error)}`,
    );
  }
  if (parsed.data.status === 'success') {
    fail('Iyzico approved a payment made with a documented declining card.');
  }

  logSuccess(
    'Iyzico declined the card, and the rejection matches the response contract.',
  );
  logDetail('Error code', parsed.data.errorCode ?? '-');
  logDetail('Error message', parsed.data.errorMessage ?? '-');
}

const wait = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function run(): Promise<void> {
  const { baseUrl, client, get } = buildScriptContext();
  const conversationId = `payment-refund-check-${Date.now()}`;
  const paymentRequest = buildPaymentRequest(conversationId);

  logHeader(
    'Iyzico Payment & Refund Verification',
    'Runs the complete charge-to-refund journey without a browser.',
  );
  logStep(
    `Step 1 of ${TOTAL_STEPS} · Charging the official sandbox test card…`,
  );
  logDetail('Endpoint', `POST ${baseUrl}${PAYMENT_ENDPOINT}`);
  logDetail('Conversation ID', conversationId);
  logDetail('Charge amount', price, currency);
  logDetail(
    'Basket lines',
    `${itemCount} × ${itemPrices[itemPrices.length - 1]} ${currency}`,
  );

  const paymentRaw = await client
    .post<unknown>(PAYMENT_ENDPOINT, paymentRequest)
    .catch((error: unknown) =>
      fail(`The payment request did not complete. ${describeError(error)}`),
    );
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
  logStep(
    `Step 2 of ${TOTAL_STEPS} · Retrieving the payment persisted by Iyzico…`,
  );
  logDetail('Endpoint', `POST ${baseUrl}${PAYMENT_DETAIL_ENDPOINT}`);
  logDetail('Conversation ID', detailConversationId);
  const detailRaw = await client
    .post<unknown>(PAYMENT_DETAIL_ENDPOINT, {
      conversationId: detailConversationId,
      locale: 'tr',
      paymentId: payment.paymentId,
    })
    .catch((error: unknown) =>
      fail(
        `The payment detail request did not complete. ${describeError(error)}`,
      ),
    );
  const detail = parseRetrievedPayment(detailRaw);

  if (detail.paymentStatus !== 'SUCCESS') {
    fail(
      `The retrieved payment is not successful. Payment status: ${detail.paymentStatus}.`,
    );
  }

  assertPaymentContents(detail, {
    basketId: payment.basketId,
    conversationId: detailConversationId,
    currency: payment.currency,
    paidPrice: payment.paidPrice,
    paymentId: payment.paymentId,
    price: payment.price,
    transactionIds: payment.itemTransactions.map(
      ({ paymentTransactionId }) => paymentTransactionId,
    ),
  });
  assertPaymentSignature(client, detail);
  logSuccess('Persisted payment retrieved and fully verified.');
  logDetail('Payment status', detail.paymentStatus);
  logDetail(
    'Validated checks',
    'Identity · State · Items · Totals · Signature',
  );

  const expectedRefunds: RefundExpectation[] = [];
  let capturedRefund:
    (IyzicoRefundResponse & { status: 'success' }) | undefined;
  logStep(
    `Step 3 of ${TOTAL_STEPS} · Refunding ${detail.itemTransactions.length} item transaction(s)…`,
  );
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
      .catch((error: unknown) =>
        fail(`The refund request did not complete. ${describeError(error)}`),
      );
    const parsed = iyzicoRefundResponseSchema.safeParse(raw);
    if (!parsed.success) {
      fail(
        `Iyzico returned an invalid refund response:\n${describeValidationIssues(parsed.error)}`,
      );
    }

    const refund = parsed.data;
    if (refund.status === 'failure') {
      fail(
        `Iyzico declined the refund. [${refund.errorCode ?? '-'}] ${refund.errorMessage ?? '-'}`,
      );
    }

    assertEqual('refund paymentId', refund.paymentId, payment.paymentId);
    assertEqual(
      'refund conversationId',
      refund.conversationId,
      request.conversationId,
    );
    assertEqual('refund currency', refund.currency, request.currency);
    assertEqual(
      'refund paymentTransactionId',
      refund.paymentTransactionId,
      request.paymentTransactionId,
    );
    assertEqual('refund price', refund.price, request.price);

    if (
      !client.verifyResponseSignature(
        [
          refund.paymentId,
          refund.price,
          refund.currency,
          refund.conversationId,
        ],
        refund.signature,
      )
    ) {
      fail('The refund response signature is invalid.');
    }

    capturedRefund ??= refund;
    logSuccess(`Refund accepted and verified for item ${item.itemId}.`);
  }

  const reportConversationId = `${conversationId}-report`;
  logStep(
    `Step 4 of ${TOTAL_STEPS} · Waiting for every refund to appear in Iyzico reporting…`,
  );
  logDetail('Endpoint', `GET ${baseUrl}${REPORTING_ENDPOINT}`);
  logDetail('Maximum attempts', REPORTING_ATTEMPTS);
  let reportConfirmed = false;
  for (
    let attempt = 1;
    attempt <= REPORTING_ATTEMPTS && !reportConfirmed;
    attempt += 1
  ) {
    const raw = await get<unknown>(REPORTING_ENDPOINT, {
      conversationId: reportConversationId,
      locale: 'tr',
      paymentId: payment.paymentId,
    }).catch((error: unknown) =>
      fail(`The reporting request did not complete. ${describeError(error)}`),
    );
    const report = parseReport(raw);

    if (report.conversationId !== undefined) {
      assertEqual(
        'report conversationId',
        report.conversationId,
        reportConversationId,
      );
    }
    if (reportContainsRefunds(report, payment.paymentId, expectedRefunds)) {
      logSuccess(
        'Iyzico reporting confirms that the payment is fully refunded and every item refund is recorded.',
      );
      reportConfirmed = true;
    } else if (attempt < REPORTING_ATTEMPTS) {
      logDetail(
        'Reporting status',
        `Refunds not visible yet · Attempt ${attempt}/${REPORTING_ATTEMPTS}`,
      );
      await wait(REPORTING_RETRY_DELAY_MS);
    }
  }
  if (!reportConfirmed) {
    fail(
      `Iyzico reporting did not confirm every refund after ${REPORTING_ATTEMPTS} attempts.`,
    );
  }

  await verifyRepeatedRefundIsRejected(
    client,
    detail.itemTransactions[0],
    conversationId,
  );
  await verifyUnknownTransactionIsRejected(client, conversationId);
  await verifyUnknownPaymentIsRejected(client, conversationId);
  if (capturedRefund) verifyTamperedSignatureIsRejected(client, capturedRefund);
  await verifyDecliningCardIsRejected(client);

  logCelebration(
    'Payment creation, persistence, complete refund and every failure path verified in the Iyzico sandbox.',
  );
}

run().catch((error: unknown) =>
  fail(
    `Unexpected payment and refund verification failure. ${describeError(error)}`,
  ),
);
