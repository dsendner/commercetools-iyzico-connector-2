import { Cart, Payment } from "@commercetools/connect-payments-sdk";
import { centAmountToIyzicoPrice, IyzicoAddress, IyzicoBasketItem, IyzicoBuyer, mapAddress, mapBasketItems, mapBuyer, toIyzicoLocale, validateBasketTotal } from "./iyzico-cart.mapper";

export interface IyzicoInitializeRequest {
  locale: string;
  conversationId: string;
  price: string;
  paidPrice: string;
  currency: string;
  basketId: string;
  paymentGroup: string;
  callbackUrl: string;
  cardUserKey?: string;
  enabledInstallments?: number[];
  buyer: IyzicoBuyer;
  shippingAddress: IyzicoAddress;
  billingAddress: IyzicoAddress;
  basketItems: IyzicoBasketItem[];
}

export interface IyzicoInitializeResponse {
  status: 'Success' | 'Failure';
  errorCode?: string;
  errorMessage?: string;
  locale?: string;
  systemTime?: number;
  conversationId: string;
  token: string;
  checkoutFormContent: string;
  paymentPageUrl: string;
  signature?: string;
  tokenExpireTime?: number;
}

export function toIyzicoInitializeRequest(
  cart: Cart,
  payment: Payment,
  callbackUrl: string,
  clientIp: string,
  cardUserKey?: string,
): IyzicoInitializeRequest {
  const total = cart.totalPrice;
  const price = centAmountToIyzicoPrice(total.centAmount, total.fractionDigits);
  const basketItems = mapBasketItems(cart);

  validateBasketTotal(basketItems, total, price);

  return {
    locale: toIyzicoLocale(cart.locale),
    conversationId: payment.id,
    price,
    paidPrice: price,
    currency: total.currencyCode,
    basketId: cart.id,
    paymentGroup: 'PRODUCT',
    callbackUrl,
    cardUserKey,
    buyer: mapBuyer(cart, clientIp),
    billingAddress: mapAddress(cart.billingAddress),
    shippingAddress: mapAddress(cart.shippingAddress ?? cart.billingAddress),
    basketItems,
  };
}