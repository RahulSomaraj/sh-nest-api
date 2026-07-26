import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * The authenticated principal attached by a passport guard (`req.user` in legacy
 * Express). Works for both surfaces: an Administrator document on `admin/v2`
 * routes, a User document on `api` routes.
 *
 *   @CurrentUser() user: UserDocument
 *   @CurrentUser('_id') userId: Types.ObjectId
 */
export const CurrentUser = createParamDecorator(
  (field: string | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user;
    return field ? user?.[field] : user;
  },
);
