import type { Cart, Payment, Address, LineItem } from '@commercetools/platform-sdk';

export interface IyzicoInitializeRequest {
  locale: string;
  conversationId: string;   // CT payment id — round-trips so we can match the response
  price: string;            // decimal string e.g. "49.90"
  paidPrice: string;        // must equal the sum of basketItems
  currency: string;
  basketId: string;         // CT cart id
  paymentGroup: string;     // "PRODUCT" | "LISTING" | "SUBSCRIPTION"
  callbackUrl: string;
  cardUserKey?: string;
  enabledInstallments?: number[]; // optional; omit to let Iyzico decide. e.g. [1,2,3,6,9]
  buyer: IyzicoBuyer;
  shippingAddress: IyzicoAddress;
  billingAddress: IyzicoAddress;
  basketItems: IyzicoBasketItem[];
}

export interface IyzicoBuyer {
  id: string;
  name: string;
  surname: string;
  email: string;
  identityNumber: string;
  registrationAddress: string;
  city: string;
  country: string;
  ip: string;
}

export interface IyzicoAddress {
  contactName: string;
  city: string;
  country: string;
  address: string;
}

export interface IyzicoBasketItem {
  id: string;
  name: string;
  category1: string;
  itemType: 'PHYSICAL' | 'VIRTUAL';
  price: string;
}

export interface IyzicoInitializeResponse {
  status: 'Success' | 'Failure';
  errorCode?: string;
  errorMessage?: string;
  locale?: string;
  systemTime?: number;          // epoch ms
  conversationId: string;
  token: string;                // needed for /retrieve in the confirm step
  checkoutFormContent: string;  // JS snippet to embed (renders Iyzico's form)
  paymentPageUrl: string;       // hosted-page redirect URL
  signature?: string;           // HMAC of response fields — verify in confirm step
  tokenExpireTime?: number;     // present on some API versions
}

function contactName(addr?: Address): string {
  return [addr?.firstName, addr?.lastName].filter(Boolean).join(' ') || 'N/A';
}

function singleLineAddress(addr?: Address): string {
  return [addr?.streetName, addr?.streetNumber, addr?.postalCode]
    .filter(Boolean)
    .join(' ') || 'N/A';
}

function mapAddress(addr?: Address): IyzicoAddress {
  return {
    contactName: contactName(addr),
    city: addr?.city ?? 'N/A',
    country: addr?.country ?? 'N/A',
    address: singleLineAddress(addr),
  };
}

function lineItemName(item: LineItem, locale?: string): string {
  const key = locale?.split('-')[0];
  return (key && item.name[key]) || Object.values(item.name)[0] || 'item';
}

function mapLineItem(item: LineItem, locale?: string): IyzicoBasketItem {
  return {
    id: item.id,
    name: lineItemName(item, locale),
    category1: 'General',
    itemType: 'PHYSICAL',
    price: centAmountToIyzicoPrice(item.totalPrice.centAmount, item.totalPrice.fractionDigits),
  };
}

export function toIyzicoInitializeRequest(
  cart: Cart,
  payment: Payment,
  callbackUrl: string,
  clientIp: string,
  cardUserKey?: string
): IyzicoInitializeRequest {
  const total = cart.totalPrice;
  const price = centAmountToIyzicoPrice(total.centAmount, total.fractionDigits);

  const basketItems = cart.lineItems.map((item) => mapLineItem(item, cart.locale));

  const basketTotal = basketItems
    .reduce((sum, item) => sum + parseFloat(item.price), 0)
    .toFixed(total.fractionDigits);

  if (basketTotal !== price) {
    throw new Error(
      `Basket items total (${basketTotal}) does not equal cart total (${price}). ` +
        `Iyzico requires the sum of line items to match the paid price exactly. ` +
        `This usually means shipping/discounts are not represented as line items.`,
    );
  }

  return {
    locale: toIyzicoLocale(cart.locale),
    conversationId: payment.id,
    price,
    paidPrice: price,
    currency: total.currencyCode,
    basketId: cart.id,
    paymentGroup: 'PRODUCT',
    callbackUrl,
    cardUserKey: cardUserKey,
    buyer: {
      id: cart.customerId ?? cart.anonymousId ?? 'guest',
      name: cart.billingAddress?.firstName ?? 'N/A',
      surname: cart.billingAddress?.lastName ?? 'N/A',
      email: cart.customerEmail ?? cart.billingAddress?.email ?? 'noemail@example.com',
      // Iyzico requires a Turkish identity number; we fake it so use the documented test value.
      identityNumber: '74300864791',
      registrationAddress: singleLineAddress(cart.billingAddress),
      city: cart.billingAddress?.city ?? 'N/A',
      country: cart.billingAddress?.country ?? 'N/A',
      ip: clientIp,
    },

    billingAddress: mapAddress(cart.billingAddress),
    shippingAddress: mapAddress(cart.shippingAddress ?? cart.billingAddress),
    basketItems,
  };
}

function centAmountToIyzicoPrice(centAmount: number, fractionDigits = 2) : string {
    return (centAmount / Math.pow(10, fractionDigits)).toFixed(fractionDigits);
}

function toIyzicoLocale(locale: string | undefined): string {
    if(!locale) return 'tr'
   return locale.split('-')[0].toLowerCase();

}