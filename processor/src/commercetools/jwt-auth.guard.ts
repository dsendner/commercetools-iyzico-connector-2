import { JWTAuthenticationHook } from '@commercetools/connect-payments-sdk';
import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { CT_JWT_AUTH_HOOK } from './tokens';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    @Inject(CT_JWT_AUTH_HOOK)
    private readonly jwtAuthHook: JWTAuthenticationHook,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    try {
      await this.jwtAuthHook.authenticate()({ headers: request.headers });
    } catch {
      throw new UnauthorizedException('Invalid JWT');
    }

    return true;
  }
}