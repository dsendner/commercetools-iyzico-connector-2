export interface TransactionItemDraft {
  paymentIntegration: { typeId: string; id: string };
  amount: { centAmount: number; currencyCode: string };
}

export interface TransactionDraft {
  key: string;
  application: { typeId: string; id: string };
  cart: { typeId: string; id: string };
  transactionItems: [TransactionItemDraft]; // tuple — exactly 1
}

export interface TransactionResponse {
  id: string;
  version: number;
  key: string;
  transactionStatus: {
    state: 'Initial' | 'Pending' | 'Completed' | 'Failed';
    errors?: Array<{ code: string; message: string }>;
  };
}