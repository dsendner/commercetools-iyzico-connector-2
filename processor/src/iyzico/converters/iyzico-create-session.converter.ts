import { Cart, Payment } from "@commercetools/connect-payments-sdk";
import { centAmountToIyzicoPrice, IyzicoAddress, IyzicoBasketItem, IyzicoBuyer, mapAddress, mapBasketItems, mapBuyer, toIyzicoLocale, calculateBasketItemsTotal } from "./iyzico-cart.mapper";

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
  status: 'success' | 'failure';
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
  cardUserKey: string | undefined,
  conversationId: string,
  enabledInstallments?: number[],
): IyzicoInitializeRequest {
  const basketItems = mapBasketItems(cart);
  
  // price = sum of basket items (gross, before discounts)
  const priceTotalValue = calculateBasketItemsTotal(basketItems);
  const price = priceTotalValue.toFixed(cart.totalPrice.fractionDigits);
  
  // paidPrice = actual amount to charge (after all discounts)
  const paidPrice = centAmountToIyzicoPrice(
    cart.totalPrice.centAmount,
    cart.totalPrice.fractionDigits
  );

  return {
    locale: toIyzicoLocale(cart.locale),
    conversationId: conversationId,
    price,
    paidPrice,
    currency: cart.totalPrice.currencyCode,
    basketId: cart.id,
    paymentGroup: 'PRODUCT',
    callbackUrl,
    cardUserKey,
    enabledInstallments,
    buyer: mapBuyer(cart, clientIp),
    billingAddress: mapAddress(cart.billingAddress),
    shippingAddress: mapAddress(cart.shippingAddress ?? cart.billingAddress),
    basketItems,
  };
}