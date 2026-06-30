import { SessionHeaderAuthenticationHook } from "@commercetools/connect-payments-sdk";
import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { CT_SESSION_AUTH_HOOK } from "./commercetools.module";
import { getRequestContext } from "../commercetools/request-context";

@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(
    @Inject(CT_SESSION_AUTH_HOOK)
    private readonly sessionAuthHook: SessionHeaderAuthenticationHook,
) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    await this.sessionAuthHook.authenticate()({ headers: request.headers });

    const cartId = getCartIdFromRequest(getRequestContext());

    if(!cartId) {
        throw new UnauthorizedException('No cart associated with this session');
    }

    request.cartId = cartId;
    return true;
  }
}


export declare function getCartIdFromRequest(request: any): string | undefined;
