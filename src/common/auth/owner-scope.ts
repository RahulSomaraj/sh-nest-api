import { ForbiddenException } from '@nestjs/common';
import { Model } from 'mongoose';

/**
 * audit A5/A6/A7: shared owner-scoping helper for by-id operations (IDOR fix).
 *
 * The list endpoints already restrict own-scoped admins (LIST_OWN_* without LIST_ALL_*)
 * to properties where `administrator == me` or `me ∈ allAdministrators`. This helper
 * applies the same rule to by-id reads/writes: resolve the caller's property ids once,
 * then require the target's property reference to be in that set, else 403.
 *
 * Scoping rule mirrors the v2 list behaviour exactly: it applies only when the caller
 * holds the OWN permission and NOT the ALL permission; callers with neither are left
 * unrestricted (v2 parity), full-access admins are unaffected.
 */
export interface OwnAllPermissions {
  own: string;
  all: string;
}

export const PROPERTY_SCOPE: OwnAllPermissions = {
  own: 'LIST_OWN_PROPERTIES',
  all: 'LIST_ALL_PROPERTIES',
};

export const BOOKING_SCOPE: OwnAllPermissions = {
  own: 'LIST_OWN_BOOKINGS',
  all: 'LIST_ALL_BOOKINGS',
};

/**
 * Resolve the property ids the caller may act on.
 * Returns `null` when the caller is unrestricted (has ALL, or lacks OWN — v2 parity).
 */
export async function ownedPropertyIds(
  user: any,
  propertyModel: Model<any>,
  scope: OwnAllPermissions,
): Promise<Set<string> | null> {
  const permissions: string[] = user?.role?.permissions || [];
  // "*" is a wildcard granting every permission (e.g. Super Admin) → unrestricted.
  const hasAll =
    permissions.indexOf('*') > -1 || permissions.indexOf(scope.all) > -1;
  const hasOwn = permissions.indexOf(scope.own) > -1;
  if (hasAll || !hasOwn) return null;
  const props = await propertyModel
    .find({
      $or: [{ administrator: user._id }, { allAdministrators: { $in: [user._id] } }],
    })
    .select('_id')
    .lean();
  return new Set(props.map((p: any) => String(p._id)));
}

/** Throw 403 unless the target's property id is inside the caller's owned set. */
export function assertOwned(owned: Set<string> | null, propertyId: any): void {
  if (owned === null) return; // unrestricted caller
  const id = propertyId?._id ?? propertyId;
  if (!id || !owned.has(String(id))) {
    throw new ForbiddenException('You do not have permission to access this resource');
  }
}
