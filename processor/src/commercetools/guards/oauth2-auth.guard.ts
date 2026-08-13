import { Oauth2AuthenticationHook } from "@commercetools/connect-payments-sdk";
import { Injectable, CanActivate, Inject, ExecutionContext, UnauthorizedException } from "@nestjs/common";
import { CT_OAUTH2_AUTH_HOOK } from "../tokens";

@Injectable()
export class OAuth2AuthGuard implements CanActivate {
    constructor(
        @Inject(CT_OAUTH2_AUTH_HOOK)
        private readonly oauth2AuthHook: Oauth2AuthenticationHook,
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest();

        try {
            await this.oauth2AuthHook.authenticate()({ headers: request.headers });
        } catch {
            throw new UnauthorizedException('Invalid OAuth2 token');
        }

        return true;
    }
}