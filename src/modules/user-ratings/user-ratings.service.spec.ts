import { BadRequestException } from '@nestjs/common';
import { UserRatingsService } from './user-ratings.service';
import { mockQuery } from '../../testing/mocks';

/**
 * Module: user-ratings (audit A4)
 * - approved/:status string params coerced to real booleans
 * - invalid values rejected with 400
 * - property rating recomputed after approval
 */
describe('Module: user-ratings (A4)', () => {
  const RATING_ID = '507f1f77bcf86cd799439011';
  const PROP_ID = '507f1f77bcf86cd799439033';

  const build = (opts: { aggregate?: any[] } = {}) => {
    const findOneAndUpdateQuery = mockQuery({ _id: RATING_ID, property: { _id: PROP_ID } });
    const updateOneQuery = mockQuery({});
    const userRatingModel: any = {
      findOneAndUpdate: jest.fn(() => findOneAndUpdateQuery),
      find: jest.fn(() => mockQuery([])),
      countDocuments: jest.fn().mockResolvedValue(0),
      aggregate: jest.fn().mockResolvedValue(opts.aggregate ?? []),
    };
    const propertyModel: any = {
      find: jest.fn(() => mockQuery([])),
      updateOne: jest.fn(() => updateOneQuery),
    };
    const service = new UserRatingsService(userRatingModel, propertyModel);
    return { service, userRatingModel, propertyModel };
  };

  describe('approval(:status)', () => {
    it("coerces 'true' to boolean true (audit A4)", async () => {
      const b = build({ aggregate: [{ _id: null, count: 2, value: 9 }] });
      await b.service.approval(RATING_ID, 'true');
      expect(b.userRatingModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: RATING_ID },
        { $set: { approved: true } },
        { new: true },
      );
    });

    it("coerces 'false' to boolean false (audit A4)", async () => {
      const b = build();
      await b.service.approval(RATING_ID, 'false');
      expect(b.userRatingModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: RATING_ID },
        { $set: { approved: false } },
        { new: true },
      );
    });

    it('rejects any other value with 400 (audit A4)', async () => {
      const b = build();
      await expect(b.service.approval(RATING_ID, 'yes')).rejects.toBeInstanceOf(BadRequestException);
      expect(b.userRatingModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('recomputes property.user_rating (rounded 1dp) after approval', async () => {
      const b = build({ aggregate: [{ _id: null, count: 2, value: 9 }] });
      await b.service.approval(RATING_ID, 'true');
      expect(b.propertyModel.updateOne).toHaveBeenCalledWith(
        { _id: PROP_ID },
        { $set: { user_rating: 4.5 } },
      );
    });
  });

  describe('list approved filter', () => {
    it("casts the 'false' query string to boolean false (audit A4)", async () => {
      const b = build();
      await b.service.list({ approved: 'false' }, false);
      expect(b.userRatingModel.find).toHaveBeenCalledWith({ approved: false });
    });

    it('omits the filter when the param is empty (legacy parity)', async () => {
      const b = build();
      await b.service.list({ approved: '' }, false);
      expect(b.userRatingModel.find).toHaveBeenCalledWith({});
    });

    it('rejects a junk approved value with 400', async () => {
      const b = build();
      await expect(b.service.list({ approved: 'junk' }, false)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });
});
