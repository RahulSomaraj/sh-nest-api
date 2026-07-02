import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import mongoose from 'mongoose';
import { AuthService } from './auth.service';
import { AdministratorSchema } from '../administrators/schemas/administrator.schema';
import { mockQuery } from '../../testing/mocks';

/**
 * Module: auth (audit A1)
 * - inactive-admin login rejected (login + auto-login)
 * - JWT carries minimal claims, never the password hash
 * - schema toJSON strips password/activationCode/autoLoginCode
 */
describe('Module: auth (A1)', () => {
  const jwtService = new JwtService({ secret: 'test-secret' });
  const config: any = { get: jest.fn() };
  const mailService: any = { sendResetPassword: jest.fn() };

  const PASSWORD = 'S3cret!pass';
  const HASH = bcrypt.hashSync(PASSWORD, 10);

  const makeAdmin = (overrides: any = {}) => ({
    _id: '507f1f77bcf86cd799439011',
    email: 'admin@test.com',
    password: HASH,
    status: true,
    role: { _id: '507f1f77bcf86cd799439022', permissions: [] },
    set: jest.fn(),
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  });

  const serviceWith = (adminDoc: any) => {
    const administratorModel: any = { findOne: jest.fn(() => mockQuery(adminDoc)) };
    return new AuthService(administratorModel, jwtService, config, mailService);
  };

  describe('validateAdministrator', () => {
    it('accepts an active admin with correct credentials', async () => {
      const service = serviceWith(makeAdmin());
      const result = await service.validateAdministrator('admin@test.com', PASSWORD);
      expect(result).not.toBeNull();
    });

    it('rejects a wrong password', async () => {
      const service = serviceWith(makeAdmin());
      const result = await service.validateAdministrator('admin@test.com', 'wrong');
      expect(result).toBeNull();
    });

    it('rejects an INACTIVE admin even with correct credentials (audit A1)', async () => {
      const service = serviceWith(makeAdmin({ status: false }));
      const result = await service.validateAdministrator('admin@test.com', PASSWORD);
      expect(result).toBeNull();
    });

    it('rejects an unknown email', async () => {
      const service = serviceWith(null);
      const result = await service.validateAdministrator('nobody@test.com', PASSWORD);
      expect(result).toBeNull();
    });
  });

  describe('signToken / buildLoginResponse', () => {
    it('signs a minimal claim set without the password hash (audit A1)', () => {
      const service = serviceWith(makeAdmin());
      const token = service.signToken(makeAdmin());
      const payload: any = jwtService.decode(token);
      expect(payload._id).toBe('507f1f77bcf86cd799439011');
      expect(payload.email).toBe('admin@test.com');
      expect(payload.role).toBe('507f1f77bcf86cd799439022');
      expect(payload.password).toBeUndefined();
      expect(payload.status).toBeUndefined(); // whole doc no longer signed
    });

    it('buildLoginResponse returns {status:1, token, user}', () => {
      const service = serviceWith(makeAdmin());
      const response = service.buildLoginResponse(makeAdmin());
      expect(response.status).toBe(1);
      expect(typeof response.token).toBe('string');
      expect(response.user).toBeDefined();
    });
  });

  describe('autoLogin', () => {
    it('rejects an inactive admin (audit A1)', async () => {
      const service = serviceWith(makeAdmin({ status: false }));
      const result: any = await service.autoLogin('admin@test.com', '1234');
      expect(result.status).toBe(0);
      expect(result.message).toBe('Invalid Login credentials');
    });

    it('logs in an active admin and clears the autoLoginCode', async () => {
      const admin = makeAdmin();
      const service = serviceWith(admin);
      const result: any = await service.autoLogin('admin@test.com', '1234');
      expect(result.status).toBe(1);
      expect(typeof result.token).toBe('string');
      expect(admin.set).toHaveBeenCalledWith('autoLoginCode', '');
      expect(admin.save).toHaveBeenCalled();
    });
  });

  describe('Administrator schema serialisation (audit A1)', () => {
    it('toJSON strips password, activationCode and autoLoginCode', () => {
      const Model =
        (mongoose.models as any).AdministratorSpecOnly ||
        mongoose.model('AdministratorSpecOnly', AdministratorSchema);
      const doc = new Model({
        name: 'Admin',
        email: 'a@b.com',
        password: HASH,
        activationCode: '1234',
        autoLoginCode: '5678',
        status: true,
      });
      const json: any = doc.toJSON();
      expect(json.password).toBeUndefined();
      expect(json.activationCode).toBeUndefined();
      expect(json.autoLoginCode).toBeUndefined();
      expect(json.name).toBe('Admin');

      const obj: any = doc.toObject();
      expect(obj.password).toBeUndefined();
    });
  });
});
