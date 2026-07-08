import { LineItem, Cart, Address } from "@commercetools/connect-payments-sdk";

export function centAmountToIyzicoPrice(centAmount: number, fractionDigits = 2): string {
  return (centAmount / Math.pow(10, fractionDigits)).toFixed(fractionDigits);
}

export function toIyzicoLocale(locale: string | undefined): string {
  if (!locale) return 'tr';
  return locale.split('-')[0].toLowerCase();
}

export function contactName(addr?: Address): string {
  return [addr?.firstName, addr?.lastName].filter(Boolean).join(' ') || 'N/A';
}

export function singleLineAddress(addr?: Address): string {
  return [addr?.streetName, addr?.streetNumber, addr?.postalCode]
    .filter(Boolean)
    .join(' ') || 'N/A';
}

export function mapAddress(addr?: Address): IyzicoAddress {
  return {
    contactName: contactName(addr),
    city: addr?.city ?? 'N/A',
    country: addr?.country ?? 'N/A',
    address: singleLineAddress(addr),
  };
}

export function lineItemName(item: LineItem, locale?: string): string {
  const key = locale?.split('-')[0];
  return (key && item.name[key]) || Object.values(item.name)[0] || 'item';
}

export function mapLineItem(item: LineItem, locale?: string): IyzicoBasketItem {
  return {
    id: item.id,
    name: lineItemName(item, locale),
    category1: 'General',
    itemType: 'PHYSICAL',
    price: centAmountToIyzicoPrice(item.totalPrice.centAmount, item.totalPrice.fractionDigits),
  };
}

export function mapBuyer(cart: Cart, clientIp: string): IyzicoBuyer {
  return {
    id: cart.customerId ?? cart.anonymousId ?? 'guest',
    name: cart.billingAddress?.firstName ?? 'N/A',
    surname: cart.billingAddress?.lastName ?? 'N/A',
    email: cart.customerEmail ?? cart.billingAddress?.email ?? 'noemail@example.com',
    identityNumber: '74300864791',
    registrationAddress: singleLineAddress(cart.billingAddress),
    city: cart.billingAddress?.city ?? 'N/A',
    country: cart.billingAddress?.country ?? 'N/A',
    ip: clientIp,
  };
}

export function mapBasketItems(cart: Cart): IyzicoBasketItem[] {
  return cart.lineItems.map((item) => mapLineItem(item, cart.locale));
}

export function validateBasketTotal(
  basketItems: IyzicoBasketItem[],
  total: Cart['totalPrice'],
  price: string,
): void {
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