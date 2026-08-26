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
  const basketItems = cart.lineItems.map((item) => mapLineItem(item, cart.locale));

  if (cart.shippingInfo?.price && cart.shippingInfo.price.centAmount > 0) {
    basketItems.push({
      id: `shipping-${cart.id}`,
      name: 'Shipping',
      category1: 'Shipping',
      itemType: 'PHYSICAL',
      price: centAmountToIyzicoPrice(
        cart.shippingInfo.price.centAmount,
        cart.shippingInfo.price.fractionDigits,
      ),
    });
  }

  if (cart.customLineItems?.length) {
    for (const item of cart.customLineItems) {
      if (item.money.centAmount !== 0) {
        basketItems.push({
          id: `custom-${item.id}`,
          name: Object.values(item.name)[0] ?? 'Custom item',
          category1: 'Custom',
          itemType: 'PHYSICAL',
          price: centAmountToIyzicoPrice(item.money.centAmount, item.money.fractionDigits),
        });
      }
    }
  }

  const discountAmount = cart.discountOnTotalPrice?.discountedAmount?.centAmount ?? 0;
  if (discountAmount > 0) {
    basketItems.push({
      id: `discount-${cart.id}`,
      name: 'Discount',
      category1: 'Discount',
      itemType: 'VIRTUAL',
      price: `-${centAmountToIyzicoPrice(discountAmount, cart.totalPrice.fractionDigits)}`,
    });
  }

  return basketItems;
}

export function validateBasketTotal(
  basketItems: IyzicoBasketItem[],
  total: Cart['totalPrice'],
  price: string,
): void {
  const basketTotalInMinorUnits = basketItems.reduce((sum, item) => {
    return sum + Math.round(Number(item.price) * Math.pow(10, total.fractionDigits));
  }, 0);

  const totalInMinorUnits = total.centAmount;

  if (basketTotalInMinorUnits !== totalInMinorUnits) {
    throw new Error(
      `Basket items total (${(basketTotalInMinorUnits / Math.pow(10, total.fractionDigits)).toFixed(total.fractionDigits)}) does not equal cart total (${price}). ` +
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