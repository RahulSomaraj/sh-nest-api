import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Equivalent of `jwtMiddleware.userAuthenticationRequired`. Apply to any `/api`
 * route that requires an authenticated customer.
 *
 * NOT interchangeable with the admin `JwtAuthGuard` — an administrator token must
 * never authenticate a customer route, and vice versa.
 */
@Injectable()
export class UserAuthGuard extends AuthGuard('jwt-user') {}

/** Equivalent of `passport.authenticate('local-user-login')` on POST /api/users/login. */
@Injectable()
export class UserLocalAuthGuard extends AuthGuard('local-user-login') {}
