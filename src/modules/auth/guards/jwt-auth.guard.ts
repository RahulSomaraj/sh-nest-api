import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Equivalent of jwtMiddleware.administratorAuthenticationRequired.
 * Apply to any controller/route that requires an authenticated administrator.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt-administrator') {}
