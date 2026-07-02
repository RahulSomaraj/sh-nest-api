import { InvoicesService } from './invoices.service';
import { mockQuery } from '../../testing/mocks';

/**
 * Module: invoices (audit A8 — mass assignment)
 * - create/modify only accept the explicit WRITABLE_FIELDS allowlist
 */
describe('Module: invoices (A8 mass assignment)', () => {
  let lastCreated: any;

  const build = (existing: any = null) => {
    function InvoiceModelCtor(this: any, data: any) {
      Object.assign(this, data);
      this.save = jest.fn().mockResolvedValue(this);
      lastCreated = data;
    }
    const invoiceModel: any = InvoiceModelCtor;
    invoiceModel.findOne = jest.fn(() => mockQuery(existing));
    invoiceModel.populate = jest.fn().mockResolvedValue(existing);
    invoiceModel.deleteOne = jest.fn(() => mockQuery({ deletedCount: 1 }));

    const propertyModel: any = { find: jest.fn(() => mockQuery([])) };
    const config: any = { get: jest.fn() };
    const service = new InvoicesService(invoiceModel, propertyModel, config);
    return { service, invoiceModel };
  };

  it('create keeps allowlisted fields and drops junk (audit A8)', async () => {
    const { service } = build();
    await service.create({
      amount: 500,
      status: 'pending',
      property: '507f1f77bcf86cd799439033',
      __proto__pollution: 'x',
      isAdmin: true,
      hacked: 'yes',
    });
    expect(lastCreated.amount).toBe(500);
    expect(lastCreated.status).toBe('pending');
    expect(lastCreated.property).toBe('507f1f77bcf86cd799439033');
    expect(lastCreated.hacked).toBeUndefined();
    expect(lastCreated.isAdmin).toBeUndefined();
  });

  it('modify applies only allowlisted fields to the loaded doc (audit A8)', async () => {
    const existing: any = { _id: 'i1', amount: 100, save: jest.fn().mockResolvedValue(undefined) };
    const { service } = build(existing);
    await service.modify('i1', { amount: 900, paid: true, injected: 'field' });
    expect(existing.amount).toBe(900);
    expect(existing.injected).toBeUndefined();
    // `paid` is not an invoice schema field (booking-level flag) — must be dropped too.
    expect(existing.paid).toBeUndefined();
  });

  it('modify returns null for a missing invoice', async () => {
    const { service } = build(null);
    await expect(service.modify('nope', { amount: 1 })).resolves.toBeNull();
  });
});
