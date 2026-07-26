import { BadRequestException } from '@nestjs/common';
import { Model } from 'mongoose';

export interface CrudOptions {
  /** Human title used in the 404 message, e.g. "Country". */
  moduleTitle: string;
  /** Absolute route base for pagination URLs, e.g. "/admin/v2/countries". */
  basePath: string;
  /** Mongoose populate spec (string | array). */
  populations?: any;
  /** Query keys copied verbatim into the where clause (e.g. ['country'] for cities). */
  filters?: string[];
}

/**
 * Generic listing + CRUD mirroring the legacy standard controllers
 * (admin/controllers/v2/{countries,cities,currencies,...}.js). Response envelopes match
 * legacy exactly. Pagination is DB-side (skip/limit/lean) — no full-collection loads.
 */
export class BaseCrudService {
  constructor(
    protected readonly model: Model<any>,
    protected readonly options: CrudOptions,
  ) {}

  private buildPages(limit: number, pageCount: number, currentPage: number) {
    const pages: { number: number; url: string }[] = [];
    const maxPages = 10;
    let start = Math.max(1, currentPage - Math.floor(maxPages / 2));
    const end = Math.min(pageCount, start + maxPages - 1);
    start = Math.max(1, Math.min(start, Math.max(1, end - maxPages + 1)));
    for (let n = start; n <= end; n++) {
      pages.push({ number: n, url: `${this.options.basePath}?page=${n}&limit=${limit}` });
    }
    return pages;
  }

  private prepareWhere(query: any) {
    const where: any = {};
    for (const key of this.options.filters || []) {
      const value = query[key];
      if (value === undefined || value === '') continue;
      // audit C-2: only accept scalar filter values; reject operator-injection objects.
      if (typeof value !== 'string' && typeof value !== 'number') {
        throw new BadRequestException(`Invalid ${key}`);
      }
      where[key] = value;
    }
    return where;
  }

  async list(query: any) {
    const limit = Math.min(parseInt(query.limit, 10) || 10, 100);
    const activePage = parseInt(query.page, 10) || 1;
    const skip = (activePage - 1) * limit;

    const where = this.prepareWhere(query);
    let sort: any = { _id: 1 };
    if (query.order && query.orderBy) {
      sort = {};
      sort[query.orderBy] = query.order === 'asc' ? 1 : -1;
    }

    const [list, itemCount] = await Promise.all([
      this.model
        .find(where)
        .populate(this.options.populations || [])
        .sort(sort)
        .limit(limit)
        .skip(skip)
        .lean()
        .exec(),
      this.model.countDocuments(where),
    ]);

    const pageCount = Math.ceil(itemCount / limit);
    return {
      list,
      itemCount,
      pageCount,
      pages: this.buildPages(limit, pageCount, activePage),
      active_page: activePage,
    };
  }

  async single(id: string) {
    const resource = await this.model
      .findOne({ _id: id })
      .populate(this.options.populations || [])
      .lean()
      .exec();
    return resource || { notFound: true };
  }

  private applyImage(data: any, file: any) {
    if (file && file.path) data.image = file.path;
    return data;
  }

  async create(data: any, file?: any) {
    const resource = new this.model(this.applyImage({ ...data }, file));
    await resource.save();
    await this.model.populate(resource, this.options.populations || []);
    return resource;
  }

  async modify(id: string, data: any, file?: any) {
    const resourceData = this.applyImage({ ...data }, file);
    const resource: any = await this.model.findOne({ _id: id });
    if (!resource) return null;
    Object.keys(resourceData).forEach((key) => {
      resource[key] = resourceData[key];
    });
    await resource.save();
    await this.model.populate(resource, this.options.populations || []);
    return resource;
  }

  async remove(id: string) {
    return this.model.deleteOne({ _id: id }).exec();
  }
}
