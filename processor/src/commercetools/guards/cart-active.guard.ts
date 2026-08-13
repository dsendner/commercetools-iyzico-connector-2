import {
    BadRequestException,
    CanActivate,
    ExecutionContext,
    Inject,
    Injectable,
    Logger,
    SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import * as connectPaymentsSdk from '@commercetools/connect-payments-sdk';
import { CT_CART_SERVICE } from '../../commercetools/tokens';

export type CartRequirement = 'active' | 'active-with-customer';

export const RequireCart = (requirement: CartRequirement = 'active') =>
    SetMetadata('cart-requirement', requirement);

@Injectable()
export class CartActiveGuard implements CanActivate {
    private readonly logger = new Logger(CartActiveGuard.name);

    constructor(
        @Inject(CT_CART_SERVICE)
        private readonly ctCart: connectPaymentsSdk.CommercetoolsCartService,
        private readonly reflector: Reflector,
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
         this.logger.warn(`>>> CartActiveGuard invoked`);
        const requirement = this.reflector.get<CartRequirement>(
            'cart-requirement',
            context.getHandler(),
        ) ?? 'active';

        const request = context.switchToHttp().getRequest();
        const cartId = this.extractCartId(request);

        if (!cartId) {
            throw new BadRequestException({
                code: 'MissingCartId',
                message: 'No cartId in request',
            });
        }

        const cart = await this.ctCart.getCart({ id: cartId }).catch(() => {
            throw new BadRequestException({
                code: 'CartNotFound',
                message: `Cart ${cartId} not found`,
            });
        });

        if (cart.cartState !== 'Active') {
            this.logger.warn(`Request rejected: cart ${cart.id} is ${cart.cartState}`);
            throw new BadRequestException({
                code: 'CartNotActive',
                message: `Cart ${cart.id} is in state ${cart.cartState}, expected Active`,
            });
        }

        if (requirement === 'active-with-customer' && !cart.customerId) {
            throw new BadRequestException({
                code: 'GuestCart',
                message: `Cart ${cart.id} has no customerId — required for this operation`,
            });
        }

        request.cart = cart;
        return true;
    }

    private extractCartId(request: any): string | undefined {
        if (request.cartId) return request.cartId;

        if (request.body?.cart?.id) return request.body.cart.id;

        return undefined;
    }
}