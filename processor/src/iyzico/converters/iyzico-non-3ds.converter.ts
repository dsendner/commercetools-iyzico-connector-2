import { Cart, Payment } from "@commercetools/connect-payments-sdk";
import { centAmountToIyzicoPrice, IyzicoAddress, IyzicoBasketItem, IyzicoBuyer, mapAddress, mapBasketItems, mapBuyer, toIyzicoLocale, validateBasketTotal } from "./iyzico-cart.mapper";

export interface IyzicoNon3dsRequest {
  locale: string;
  conversationId: string;
  price: string;
  paidPrice: string;
  currency: string;
  installment: number;
  paymentChannel: string;
  basketId: string;
  paymentGroup: string;
  paymentCard: {
    cardToken: string;
    cardUserKey: string;
  };
  buyer: IyzicoBuyer;
  shippingAddress: IyzicoAddress;
  billingAddress: IyzicoAddress;
  basketItems: IyzicoBasketItem[];
}

export interface IyzicoConvertedPayout {
  paidPrice: number;
  iyziCommissionRateAmount: number;
  iyziCommissionFee: number;
  blockageRateAmountMerchant: number;
  blockageRateAmountSubMerchant: number;
  subMerchantPayoutAmount: number;
  merchantPayoutAmount: number;
  iyziConversionRate: number;
  iyziConversionRateAmount: number;
  currency: string;
}

export interface IyzicoItemTransaction {
  itemId: string;
  paymentTransactionId: string;
  transactionStatus: number;
  price: number;
  paidPrice: number;
  merchantCommissionRate: number;
  merchantCommissionRateAmount: number;
  iyziCommissionRateAmount: number;
  iyziCommissionFee: number;
  blockageRate: number;
  blockageRateAmountMerchant: number;
  blockageRateAmountSubMerchant: number;
  blockageResolvedDate: string;
  subMerchantPrice: number;
  subMerchantPayoutRate: number;
  subMerchantPayoutAmount: number;
  merchantPayoutAmount: number;
  convertedPayout: IyzicoConvertedPayout;
}

export interface IyzicoNon3dsResponse {
  status: 'success' | 'failure';
  locale: string;
  systemTime: number;
  conversationId: string;
  paymentId: string;
  authCode: string;
  hostReference: string;
  phase: string;
  price: number;
  paidPrice: number;
  installment: number;
  currency: string;
  basketId: string;
  cardType: string;
  cardAssociation: string;
  cardFamily: string;
  binNumber: string;
  lastFourDigits: string;
  fraudStatus: number;
  merchantCommissionRate: number;
  merchantCommissionRateAmount: number;
  iyziCommissionRateAmount: number;
  iyziCommissionFee: number;
  itemTransactions: IyzicoItemTransaction[];
  errorCode?: string;
  errorMessage?: string;
  errorGroup?: string;
}

type Amount = { centAmount: number; currencyCode: string; fractionDigits?: number };

export function toIyzicoNon3dsRequest(
  cart: Cart,
  payment: Payment,
  amount: Amount,
  cardToken: string,
  cardUserKey: string,
): IyzicoNon3dsRequest {

  const price = centAmountToIyzicoPrice(
    amount.centAmount,
    amount.fractionDigits ?? cart.totalPrice.fractionDigits,
  );

  return {
    locale: toIyzicoLocale(cart.locale),
    conversationId: payment.id,
    price,
    paidPrice: price,
    currency: amount.currencyCode,
    installment: 1,
    paymentChannel: 'WEB',
    basketId: cart.id,
    paymentGroup: 'SUBSCRIPTION',
    paymentCard: {
      cardToken,
      cardUserKey,
    },
    buyer: mapBuyer(cart, '127.0.0.1'),
    billingAddress: mapAddress(cart.billingAddress),
    shippingAddress: mapAddress(cart.shippingAddress ?? cart.billingAddress),
    basketItems: [{
      id: cart.id,
      name: 'Subscription renewal',
      category1: 'Subscription',
      itemType: 'VIRTUAL',
      price,
    }],
  };
}
