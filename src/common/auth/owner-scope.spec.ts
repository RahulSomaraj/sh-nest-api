import { ForbiddenException } from '@nestjs/common';
import {
  assertOwned,
  ownedPropertyIds,
  PROPERTY_SCOPE,
  BOOKING_SCOPE,
} from './owner-scope';
import { mockQuery, userWithPermissions } from '../../testing/mocks';

/**
 * Common: owner-scope helper (audit A5/A6/A7)
 */
describe('Common: owner-scope helper (A5/A6/A7)', () => {
  const OWNED = '507f1f77bcf86cd799439033';
  const propertyModel: any = { find: jest.fn(() => mockQuery([{ _id: OWNED }])) };

  beforeEach(() => propertyModel.find.mockClear());

  describe('ownedPropertyIds', () => {
    it('returns null (unrestricted) for LIST_ALL_* holders', async () => {
      const user = userWithPermissions(['LIST_OWN_PROPERTIES', 'LIST_ALL_PROPERTIES']);
      await expect(ownedPropertyIds(user, propertyModel, PROPERTY_SCOPE)).resolves.toBeNull();
      expect(propertyModel.find).not.toHaveBeenCalled();
    });

    it('returns null for callers without the OWN permission (v2 list-rule parity)', async () => {
      const user = userWithPermissions(['LIST_PROPERTIES']);
      await expect(ownedPropertyIds(user, propertyModel, PROPERTY_SCOPE)).resolves.toBeNull();
    });

    it('returns the owned id set for OWN-without-ALL callers', async () => {
      const user = userWithPermissions(['LIST_OWN_BOOKINGS']);
      const owned = await ownedPropertyIds(user, propertyModel, BOOKING_SCOPE);
      expect(owned).toBeInstanceOf(Set);
      expect(owned!.has(OWNED)).toBe(true);
    });

    it('handles a missing user defensively (unrestricted)', async () => {
      await expect(ownedPropertyIds(undefined, propertyModel, PROPERTY_SCOPE)).resolves.toBeNull();
    });
  });

  describe('assertOwned', () => {
    const owned = new Set([OWNED]);

    it('passes for an owned id (string or populated doc)', () => {
      expect(() => assertOwned(owned, OWNED)).not.toThrow();
      expect(() => assertOwned(owned, { _id: OWNED })).not.toThrow();
    });

    it('throws ForbiddenException for a foreign id', () => {
      expect(() => assertOwned(owned, '507f1f77bcf86cd799439099')).toThrow(ForbiddenException);
    });

    it('throws for a missing property reference', () => {
      expect(() => assertOwned(owned, undefined)).toThrow(ForbiddenException);
    });

    it('never throws for unrestricted callers (null set)', () => {
      expect(() => assertOwned(null, 'anything')).not.toThrow();
    });
  });
});
