import { AuthorityAuthorizationHook } from "@commercetools/connect-payments-sdk";
import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable, SetMetadata } from "@nestjs/common";
import { CT_AUTHORITY_AUTH_HOOK } from "../tokens";
import { Reflector } from "@nestjs/core";

export const RequiredScopes = (...scopes: string[]) => SetMetadata('required-scopes', scopes);

@Injectable()
export class AuthorityAuthGuard implements CanActivate {
    constructor(
        @Inject(CT_AUTHORITY_AUTH_HOOK)
        private readonly authorityAuthHook: AuthorityAuthorizationHook,
        private readonly reflector: Reflector,
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const scopes = this.reflector.get<string[]>('required-scopes', context.getHandler());

        if (!scopes || scopes.length === 0) {
            return true;
        }

        try {
            await this.authorityAuthHook.authorize(...scopes)();
        } catch {
            throw new ForbiddenException('Insufficient scopes');
        }

        return true;
    }
}