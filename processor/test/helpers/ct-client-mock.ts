import * as connectPaymentsSdk from '@commercetools/connect-payments-sdk';
import { AppConfigService } from '../../src/config/config.service';
import { IyzicoClient } from '../../src/iyzico/iyzico.client';
import { IyzicoCardService } from '../../src/iyzico/iyzico-card.service';
import { IyzicoPaymentService } from '../../src/iyzico/iyzico-payment.service';

export interface MockedCTServices {
    cart: jest.Mocked<connectPaymentsSdk.CommercetoolsCartService>;
    payment: jest.Mocked<connectPaymentsSdk.CommercetoolsPaymentService>;
    paymentMethods: jest.Mocked<connectPaymentsSdk.CommercetoolsPaymentMethodService>;
}

export interface MockedIyzico {
    client: jest.Mocked<IyzicoClient>;
    cardService: jest.Mocked<IyzicoCardService>;
}

export function makeCTServicesMock(): MockedCTServices {
    return {
        cart: {
            getCart: jest.fn(),
            getCartByPaymentId: jest.fn(),
            addPayment: jest.fn(),
        } as any,
        payment: {
            createPayment: jest.fn(),
            updatePayment: jest.fn(),
            getPayment: jest.fn(),
            findPaymentsByInterfaceId: jest.fn(),
        } as any,
        paymentMethods: {
            save: jest.fn(),
            find: jest.fn().mockResolvedValue({ results: [] }),
            get: jest.fn(),
        } as any,
    };
}

export function makeIyzicoMock(): MockedIyzico {
    return {
        client: {
            post: jest.fn(),
            verifyWebhookSignature: jest.fn().mockReturnValue(true),
        } as any,
        cardService: {
            saveCard: jest.fn(),
            getUserKey: jest.fn(),
        } as any,
    };
}

export function makeConfigMock(overrides: Record<string, string> = {}): jest.Mocked<AppConfigService> {
    const values: Record<string, string> = {
        SUBSCRIPTION_DETECTION_FIELD: 'frequencyCode',
        CTP_PROJECT_KEY: 'test-project',
        PROCESSOR_PUBLIC_URL: 'http://localhost:3000',
        DEFAULT_RETURN_URL: 'http://localhost:3000/dev/payment-result',
        NODE_ENV: 'test',
        ...overrides,
    };

    return {
        get: jest.fn().mockImplementation((key: string) => values[key]),
    } as any;
}

/**
 * Factory helper — builds a Payment matching CT shape for test fixtures.
 */
export function makePayment(overrides: Partial<connectPaymentsSdk.Payment> = {}): connectPaymentsSdk.Payment {
    return {
        id: 'payment-test-id',
        version: 1,
        createdAt: '2026-01-01T00:00:00Z',
        lastModifiedAt: '2026-01-01T00:00:00Z',
        amountPlanned: { centAmount: 10000, currencyCode: 'TRY' },
        paymentMethodInfo: { paymentInterface: 'iyzico' },
        transactions: [],
        interfaceInteractions: [],
        ...overrides,
    } as any;
}

/**
 * Factory helper — builds a Cart matching CT shape for test fixtures.
 */
export function makeCart(overrides: Partial<connectPaymentsSdk.Cart> = {}): connectPaymentsSdk.Cart {
    return {
        id: 'cart-test-id',
        version: 1,
        createdAt: '2026-01-01T00:00:00Z',
        lastModifiedAt: '2026-01-01T00:00:00Z',
        customerId: 'customer-test-id',
        cartState: 'Active',
        totalPrice: { centAmount: 10000, currencyCode: 'TRY', type: 'centPrecision', fractionDigits: 2 },
        lineItems: [],
        customLineItems: [],
        taxMode: 'Platform',
        taxRoundingMode: 'HalfEven',
        taxCalculationMode: 'LineItemLevel',
        inventoryMode: 'None',
        shippingMode: 'Single',
        origin: 'Customer',
        refusedGifts: [],
        itemShippingAddresses: [],
        ...overrides,
    } as any;
}

export function makeIyzicoCardServiceMock() {
    return {
        saveCard: jest.fn().mockResolvedValue({ id: 'pm-1' }),   // ← ajoute mockResolvedValue
        getUserKey: jest.fn().mockResolvedValue('user-key-1'),   // ← retourne une clé pour le dernier test
    };
}

export function makePaymentService(ct: any, client: any): IyzicoPaymentService {
    return new IyzicoPaymentService(
        ct.cart,
        ct.payment,
        client,
        makeIyzicoCardServiceMock() as any,
        makeConfigMock() as any,
    );
}

export const sessionRequest = {
    cartId: 'cart-1',
    clientIp: '1.2.3.4',
    cart: {
        id: 'cart-1',
        version: 1,
        cartState: 'Active',
        customerId: 'customer-test-id',
        totalPrice: { centAmount: 4990, currencyCode: 'TRY', type: 'centPrecision', fractionDigits: 2 },
        lineItems: [
            {
                id: 'li-1',
                productId: 'prod-1',
                name: { en: 'Test product' },
                quantity: 1,
                price: { value: { centAmount: 4990, currencyCode: 'TRY' } },
                totalPrice: { centAmount: 4990, currencyCode: 'TRY', type: 'centPrecision', fractionDigits: 2 },
                variant: { id: 1, sku: 'sku-1' },
                custom: undefined,
            },
        ],
    } as any,
};