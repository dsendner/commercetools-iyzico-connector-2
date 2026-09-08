import { BadRequestException } from '@nestjs/common';

import { PaymentModificationStatus } from '../../src/operations/payment-intents.dto';
import { OperationsController } from '../../src/operations/operations.controller';
import { IyzicoRecurringService } from '../../src/iyzico/iyzico-recurring.service';
import { IyzicoRefundService } from '../../src/iyzico/iyzico-refund.service';
import { stub } from '../helpers/stub';

const refundAction = {
  action: 'refundPayment',
  amount: { centAmount: 4990, currencyCode: 'TRY' },
  merchantReference: 'refund-1',
  transactionId: 'charge-1',
};

function buildRefundController() {
  const refund = jest.fn().mockResolvedValue({ outcome: PaymentModificationStatus.Approved });
  return {
    controller: new OperationsController(stub<IyzicoRecurringService>({}), stub<IyzicoRefundService>({ refund })),
    refund,
  };
}

describe('OperationsController.modifyPayment', () => {
  it('hands a valid refund action to the refund service', async () => {
    const { controller, refund } = buildRefundController();

    const response = await controller.modifyPayment('pay-1', { actions: [refundAction] });

    expect(refund).toHaveBeenCalledWith('pay-1', refundAction);
    expect(response).toEqual({ outcome: PaymentModificationStatus.Approved });
  });

  it.each([
    ['the body is not an object', 'nope'],
    ['no action is given', { actions: [] }],
    ['more than one action is given', { actions: [refundAction, refundAction] }],
    ['the action is not a refund', { actions: [{ ...refundAction, action: 'capturePayment' }] }],
    ['the amount is missing', { actions: [{ action: 'refundPayment' }] }],
    ['the amount is not positive', { actions: [{ ...refundAction, amount: { centAmount: 0, currencyCode: 'TRY' } }] }],
    [
      'the currency is not a 3-letter code',
      { actions: [{ ...refundAction, amount: { centAmount: 1, currencyCode: 'TRYY' } }] },
    ],
    [
      'the currency is not an uppercase ISO code',
      { actions: [{ ...refundAction, amount: { centAmount: 1, currencyCode: 'try' } }] },
    ],
    ['the transaction id is empty', { actions: [{ ...refundAction, transactionId: '' }] }],
  ])('rejects the request when %s', async (_, body) => {
    const { controller, refund } = buildRefundController();

    await expect(controller.modifyPayment('pay-1', body)).rejects.toBeInstanceOf(BadRequestException);
    expect(refund).not.toHaveBeenCalled();
  });
});
