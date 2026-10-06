export interface TransactionItemDraft {
  paymentIntegration: { typeId: string; id: string };
  amount: { centAmount: number; currencyCode: string };
}

export interface TransactionDraft {
  cartId?: string;
  checkoutTransactionItemId?: string;
  amount?: { centAmount: number; currencyCode: string };
  paymentMethodId?: string;
  idempotencyKey?: string;
  futureOrderNumber?: string;
  type?: 'Recurring';
  key?: string;
  application?: { typeId: string; id: string };
  cart?: { typeId: string; id: string };
  transactionItems?: [TransactionItemDraft];
}

export interface TransactionResponse {
  id: string;
  version: number;
  key?: string;
  paymentId?: string;
  transactionStatus: {
    state: 'Initial' | 'Pending' | 'Completed' | 'Failed';
    errors?: Array<{ code: string; message: string }>;
  };
}
