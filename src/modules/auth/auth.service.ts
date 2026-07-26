import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcrypt';
import * as generator from 'generate-password';
import {
  Administrator,
  AdministratorDocument,
} from '../administrators/schemas/administrator.schema';
import { MailService } from '../../common/mail/mail.service';

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(Administrator.name)
    private readonly administratorModel: Model<AdministratorDocument>,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly mailService: MailService,
  ) {}

  /** local-administrator-login strategy body. */
  async validateAdministrator(email: string, password: string) {
    const administrator = await this.administratorModel
      .findOne({ email })
      .populate('role')
      .select('+email')
      .select('+password')
      .exec();
    if (!administrator) return null;
    const isValid = await bcrypt.compare(password, administrator.password);
    if (!isValid) return null;
    // audit A1: legacy "Inactive User" behaviour — deactivated admins may not log in.
    if (administrator.status === false) return null;
    return administrator;
  }

  /**
   * audit A1: sign a minimal claim set instead of the whole document so the
   * (client-decodable) JWT never carries the password hash or other doc fields.
   * No expiry — legacy tokens never expired.
   * TODO(⚠️ PRODUCT): add expiresIn once the frontend handles token refresh/re-login.
   */
  signToken(administrator: any): string {
    const payload = {
      _id: String(administrator._id),
      email: administrator.email,
      role: administrator.role?._id
        ? String(administrator.role._id)
        : (administrator.role ?? null),
    };
    return this.jwtService.sign(payload);
  }

  /** POST /login response shape. */
  buildLoginResponse(administrator: any) {
    return {
      status: 1,
      message: 'Login successful',
      token: this.signToken(administrator),
      user: administrator,
    };
  }

  /** POST /auto-login */
  async autoLogin(email: string, autoLoginCode: string) {
    const administrator = await this.administratorModel
      .findOne({ email, autoLoginCode })
      .populate('role')
      .select('+email')
      .select('+password')
      .select('+autoLoginCodeExpiresAt')
      .exec();

    if (!administrator) {
      return { status: 0, message: 'Invalid Login token!' };
    }

    // audit (auth hardening): reject an expired auto-login token (legacy tokens without
    // an expiry remain valid for backward compatibility).
    const exp = (administrator as any).autoLoginCodeExpiresAt;
    if (exp && new Date(exp) < new Date()) {
      return { status: 0, message: 'Invalid Login token!' };
    }

    // audit A1: inactive admins may not auto-login either.
    if (administrator.status === false) {
      return { status: 0, message: 'Invalid Login credentials' };
    }

    const token = this.signToken(administrator);
    // audit (auth hardening): single-use — clear the token and its expiry after login.
    administrator.set('autoLoginCode', '');
    administrator.set('autoLoginCodeExpiresAt', undefined);
    await administrator.save();

    return {
      status: 1,
      message: 'Login successful',
      token,
      user: administrator,
    };
  }

  /** POST /reset-password */
  async resetPassword(email: string) {
    const user = await this.administratorModel
      .findOne({ email })
      .select('+email')
      .select('+password')
      .exec();

    if (!user) {
      return { status: 0, message: 'Email id is not registered with us!' };
    }

    const password = generator.generate({ length: 10, numbers: true });
    user.password = bcrypt.hashSync(password, 10);
    await user.save();

    await this.mailService.sendResetPassword(user.email, password);

    return { status: 1, message: 'New password is sent to your Email ID' };
  }

  /** POST /change-password (requires authenticated administrator) */
  async changePassword(
    adminId: string,
    oldPassword: string,
    newPassword: string,
    confirmPassword: string,
  ) {
    if (newPassword !== confirmPassword) {
      return { status: 0, message: 'Password and Confirm password must be same' };
    }

    const admin = await this.administratorModel
      .findOne({ _id: adminId })
      .select('+password')
      .exec();

    if (!admin) {
      return { status: 0, message: 'Current Password not matching.' };
    }

    const matches = await bcrypt.compare(oldPassword, admin.password);
    if (!matches) {
      return { status: 0, message: 'Current Password not matching.' };
    }

    admin.password = bcrypt.hashSync(newPassword, 10);
    const result = await admin.save();

    return {
      status: 1,
      message: 'Password updated successfully',
      data: result,
    };
  }
}
