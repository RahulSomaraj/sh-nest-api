import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'requiredPermissions';

/**
 * Declares the permission(s) an administrator's role must include to access a route.
 * Mirrors the `permissions.indexOf(config.permissions.X) > -1` checks in the legacy
 * v2 controllers.
 */
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
