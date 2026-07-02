import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from './permissions.decorator';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) {
      return true;
    }

    const req = context.switchToHttp().getRequest();
    const role = req.user?.role;
    const permissions: string[] = (role && role.permissions) || [];
    // "*" is a wildcard granting every permission (e.g. Super Admin).
    const ok =
      permissions.indexOf('*') > -1 ||
      required.every((p) => permissions.indexOf(p) > -1);
    if (!ok) {
      throw new ForbiddenException('Sorry, you do not have access to this resource');
    }
    return true;
  }
}
