import 'reflect-metadata';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { CommissionsController } from './commissions.controller';

/**
 * Module: commissions (audit A30)
 * - GET stub value preserved
 * - PUT now returns HTTP 200 (v2's 400 was a bug), body unchanged
 */
describe('Module: commissions (A30)', () => {
  const controller = new CommissionsController();

  it('GET returns the hardcoded stub value (v2 parity)', () => {
    expect(controller.get()).toEqual({ commission: 2.6666666 });
  });

  it('PUT body unchanged ({success:true})', () => {
    expect(controller.edit()).toEqual({ success: true });
  });

  it('PUT is decorated with @HttpCode(200) — v2 400 bug corrected (audit A30)', () => {
    const code = Reflect.getMetadata(HTTP_CODE_METADATA, CommissionsController.prototype.edit);
    expect(code).toBe(200);
  });
});
