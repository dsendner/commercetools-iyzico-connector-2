import { CommercetoolsCartService, CommercetoolsPaymentMethodService, CommercetoolsPaymentService, SessionHeaderAuthenticationHook, setupPaymentSDK } from '@commercetools/connect-payments-sdk';
import { Global, Module } from '@nestjs/common';
import { getRequestContext, updateRequestContext } from '../commercetools/request-context';
import { AppConfigService } from '../config/config.service';

export const PAYMENT_SDK = Symbol('PAYMENT_SDK');
export const CT_CART_SERVICE = Symbol('CT_CART_SERVICE');
export const CT_PAYMENT_SERVICE = Symbol('CT_PAYMENT_SERVICE');
export const CT_SESSION_AUTH_HOOK = Symbol('CT_SESSION_AUTH_HOOK');
export const CT_PAYMENT_METHOD_SERVICE = Symbol('CT_PAYMENT_METHOD_SERVICE');

type PaymentSdk = ReturnType<typeof setupPaymentSDK>;

@Global()
@Module({
    providers: [
        {
            provide: PAYMENT_SDK,
            inject:[AppConfigService],
            useFactory: (config: AppConfigService) => {
                const projectKey = config.get('CTP_PROJECT_KEY');
                const clientId = config.get('CTP_CLIENT_ID');
                const clientSecret = config.get('CTP_CLIENT_SECRET');
                const authUrl = config.get('CTP_AUTH_URL');
                const apiUrl = config.get('CTP_API_URL');
                const sessionUrl = config.get('CTP_SESSION_URL');
                const checkoutUrl = config.get('CTP_CHECKOUT_URL');
                const jwksUrl = config.get('CTP_JWKS_URL');
                const jwtIssuer = config.get('CTP_JWT_ISSUER');

                return setupPaymentSDK({
                    projectKey,
                    clientId,
                    clientSecret,
                    authUrl,
                    apiUrl,
                    sessionUrl,
                    checkoutUrl,
                    jwksUrl,
                    jwtIssuer,
                    getContextFn: getRequestContext,
                    updateContextFn: updateRequestContext
                });
            },
        },
        {
            provide: CT_CART_SERVICE,
            inject: [PAYMENT_SDK],
            useFactory: (sdk: PaymentSdk) :CommercetoolsCartService => sdk.ctCartService,
        },
        {
            provide: CT_PAYMENT_SERVICE,
            inject: [PAYMENT_SDK],
            useFactory: (sdk: PaymentSdk) :CommercetoolsPaymentService => sdk.ctPaymentService,
        },
        {
            provide: CT_SESSION_AUTH_HOOK,
            inject: [PAYMENT_SDK],
            useFactory: (sdk: PaymentSdk) : SessionHeaderAuthenticationHook => sdk.sessionHeaderAuthHookFn,
        },
        {
            provide: CT_PAYMENT_METHOD_SERVICE,
            inject: [PAYMENT_SDK],
            useFactory: (sdk: PaymentSdk) : CommercetoolsPaymentMethodService => sdk.ctPaymentMethodService,
        },
    ],
    exports: [PAYMENT_SDK,CT_CART_SERVICE, CT_PAYMENT_SERVICE, CT_PAYMENT_METHOD_SERVICE],
})
export class CommercetoolsModule {}
