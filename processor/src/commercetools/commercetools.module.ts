import { AuthorityAuthorizationHook, CommercetoolsCartService, CommercetoolsPaymentMethodService, CommercetoolsPaymentService, JWTAuthenticationHook, Oauth2AuthenticationHook, SessionHeaderAuthenticationHook, setupPaymentSDK } from '@commercetools/connect-payments-sdk';
import { Global, Module } from '@nestjs/common';
import { getRequestContext, updateRequestContext } from './context/request-context';
import { AppConfigService } from '../config/config.service';
import { SessionAuthGuard } from './guards/session-auth.guard';
import { CT_AUTHORITY_AUTH_HOOK, CT_CART_SERVICE, CT_JWT_AUTH_HOOK, CT_OAUTH2_AUTH_HOOK, CT_PAYMENT_METHOD_SERVICE, CT_PAYMENT_SERVICE, CT_SESSION_AUTH_HOOK, PAYMENT_SDK } from './tokens';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { OAuth2AuthGuard } from './guards/oauth2-auth.guard';
import { AuthorityAuthGuard } from './guards/authority-auth.guard';
import { CartActiveGuard } from './guards/cart-active.guard';

type PaymentSdk = ReturnType<typeof setupPaymentSDK>;

@Global()
@Module({
    providers: [
        CartActiveGuard,
        JwtAuthGuard,
        OAuth2AuthGuard,
        AuthorityAuthGuard,
        SessionAuthGuard,
        {
            provide: PAYMENT_SDK,
            inject: [AppConfigService],
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
            useFactory: (sdk: PaymentSdk): CommercetoolsCartService => sdk.ctCartService,
        },
        {
            provide: CT_PAYMENT_SERVICE,
            inject: [PAYMENT_SDK],
            useFactory: (sdk: PaymentSdk): CommercetoolsPaymentService => sdk.ctPaymentService,
        },
        {
            provide: CT_SESSION_AUTH_HOOK,
            inject: [PAYMENT_SDK],
            useFactory: (sdk: PaymentSdk): SessionHeaderAuthenticationHook => sdk.sessionHeaderAuthHookFn,
        },
        {
            provide: CT_PAYMENT_METHOD_SERVICE,
            inject: [PAYMENT_SDK],
            useFactory: (sdk: PaymentSdk): CommercetoolsPaymentMethodService => sdk.ctPaymentMethodService,
        },
        {
            provide: CT_JWT_AUTH_HOOK,
            inject: [PAYMENT_SDK],
            useFactory: (sdk: PaymentSdk): JWTAuthenticationHook => sdk.jwtAuthHookFn,
        },
        {
            provide: CT_OAUTH2_AUTH_HOOK,
            inject: [PAYMENT_SDK],
            useFactory: (sdk: PaymentSdk): Oauth2AuthenticationHook => sdk.oauth2AuthHookFn,
        },
        {
            provide: CT_AUTHORITY_AUTH_HOOK,
            inject: [PAYMENT_SDK],
            useFactory: (sdk: PaymentSdk): AuthorityAuthorizationHook => sdk.authorityAuthorizationHookFn,
        },
    ],
    exports: [
        PAYMENT_SDK,
        CT_CART_SERVICE,
        CT_PAYMENT_SERVICE,
        CT_PAYMENT_METHOD_SERVICE,
        CT_SESSION_AUTH_HOOK,
        CT_JWT_AUTH_HOOK,
        CT_OAUTH2_AUTH_HOOK,
        CT_AUTHORITY_AUTH_HOOK
    ],
})
export class CommercetoolsModule { }
