import { SessionHeaderAuthenticationHook } from "@commercetools/connect-payments-sdk";
import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { getRequestContext } from "../context/request-context";
import { CT_SESSION_AUTH_HOOK } from "../tokens";
import { log } from "console";

@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(
    @Inject(CT_SESSION_AUTH_HOOK)
    private readonly sessionAuthHook: SessionHeaderAuthenticationHook,
) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    await this.sessionAuthHook.authenticate()({ headers: request.headers });

    const cartId = this.extractCartId();

    if(!cartId) {
        throw new UnauthorizedException('No cart associated with this session');
    }

    request.cartId = cartId;
    console.log(`Authenticated session for cart ${cartId}`);
    return true;
  }

   private extractCartId(): string | undefined {
    const ctx = getRequestContext();
    const auth = ctx.authentication as any;
    return auth?.getPrincipal?.()?.cartId ?? auth?.principal?.cartId;
  }

}
