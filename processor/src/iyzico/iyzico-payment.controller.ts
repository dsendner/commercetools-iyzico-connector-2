import { Body, Controller, HttpCode, Ip, Post, Query, Req, Res, Headers, UseGuards, Get } from "@nestjs/common";
import { CreateSessionResponse, IyzicoPaymentService } from "./iyzico-payment.service";
import express from "express";
import type { IyzicoWebhookPayload } from "./converters/webhook.converter";
import { SessionAuthGuard } from "../commercetools/guards/session-auth.guard";
import { CartActiveGuard } from "../commercetools/guards/cart-active.guard";
import { Cart } from "@commercetools/connect-payments-sdk";

interface CallbackBody {
    token: string;
}

type AuthedRequest = Request & {
    cartId: string;
    cart: Cart;
};

@Controller('iyzico')
export class IyzicoPaymentController {

    constructor(private readonly paymentService: IyzicoPaymentService) { }

    @Post('session')
    @UseGuards(SessionAuthGuard, CartActiveGuard)
    async sessions(@Req() request: AuthedRequest, @Ip() clientIp: string): Promise<CreateSessionResponse> {
        return this.paymentService.createSession({
            cartId: request.cartId,
            clientIp,
            cart: request.cart
        });
    }

    @Post('payments/callback')
    async paymentsCallback(
        @Body() body: CallbackBody,
        @Query('returnUrl') returnUrl: string,
        @Res() res: express.Response
    ): Promise<void> {
        const redirectUrl = await this.paymentService.handleCallback({
            token: body.token,
            returnUrl
        });
        res.redirect(redirectUrl);
    }

    @Post('webhooks')
    @HttpCode(200)
    async webhooks(
        @Body() payload: IyzicoWebhookPayload,
        @Headers('x-iyz-signature-v3') signature: string,
    ): Promise<{ received: true }> {
        await this.paymentService.handleWebhook(payload, signature);
        return { received: true };
    }

}