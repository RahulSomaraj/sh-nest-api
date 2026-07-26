import { Test } from '@nestjs/testing';
import { getConnectionToken } from '@nestjs/mongoose';
import { INestApplication } from '@nestjs/common';
import { AppModule } from './app.module';

/**
 * Whole-application wiring test.
 *
 * The two-surface split (`admin/v2` + `api`) is applied by `RouterModule`, and a large
 * share of the customer surface is wired by hand — a missing provider, a duplicate route
 * or a module that forgets to import `ReferenceModelsModule` compiles cleanly and only
 * fails at boot. This builds the real DI graph with the Mongoose connection stubbed and
 * asserts on the routes Express actually ends up with.
 */

/** Enough of a mongoose Connection for `MongooseModule.forFeature` to build models. */
function createFakeConnection() {
  const models: Record<string, unknown> = {};
  const connection = {
    models,
    model(name: string, schema?: unknown) {
      if (!models[name]) {
        models[name] = { modelName: name, schema, collection: { name } };
      }
      return models[name];
    },
    on() {},
    once() {},
    close: async () => undefined,
    readyState: 1,
  };
  return connection;
}

/** `METHOD /path` for every route Express has registered. */
function listRoutes(app: INestApplication): string[] {
  const server = app.getHttpAdapter().getInstance() as {
    _router: { stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }> };
  };
  const routes: string[] = [];
  for (const layer of server._router.stack) {
    if (!layer.route) continue;
    for (const method of Object.keys(layer.route.methods)) {
      routes.push(`${method.toUpperCase()} ${layer.route.path}`);
    }
  }
  return routes;
}

describe('application wiring', () => {
  let app: INestApplication;
  let routes: string[];

  beforeAll(async () => {
    process.env.API_SECRET = process.env.API_SECRET || 'wiring-spec-secret';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(getConnectionToken())
      .useValue(createFakeConnection())
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
    routes = listRoutes(app);
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  });

  it('resolves the full dependency graph', () => {
    expect(routes.length).toBeGreaterThan(0);
  });

  it('mounts the admin surface under admin/v2', () => {
    expect(routes).toContain('POST /admin/v2/auth/login');
    expect(routes).toContain('GET /admin/v2/properties');
    expect(routes).toContain('GET /admin/v2/invoices');
  });

  it('mounts the customer surface under api', () => {
    // 2b users
    expect(routes).toContain('POST /api/users/login');
    expect(routes).toContain('GET /api/users/bookings');
    // 2c main
    expect(routes).toContain('GET /api/main/home');
    expect(routes).toContain('GET /api/main/v2/hotels-popular');
    // 2d properties
    expect(routes).toContain('POST /api/properties/search');
    expect(routes).toContain('GET /api/properties/filters');
    // 2e bookings + payment
    expect(routes).toContain('POST /api/bookings/checkpromo');
    expect(routes).toContain('GET /api/payment/success');
    // 2f website / misc
    expect(routes).toContain('GET /api/website/slots');
    expect(routes).toContain('POST /api/contactus');
    expect(routes).toContain('GET /api/notifications/notification_count');
    // v3
    expect(routes).toContain('POST /api/v3/guestUser');
    expect(routes).toContain('POST /api/v3/myBookings');
  });

  it('keeps health at the root, outside both prefixes', () => {
    expect(routes).toContain('GET /health');
    expect(routes.some((r) => r.includes('/admin/v2/health'))).toBe(false);
    expect(routes.some((r) => r.includes('/api/health'))).toBe(false);
  });

  it('exposes the manual invoice-generation trigger (C9)', () => {
    expect(routes).toContain('POST /admin/v2/invoices/generate');
  });

  it('declares specific routes before their parameterised siblings', () => {
    // `/api/properties/search` must win over `/api/properties/:id`, and
    // `/admin/v2/invoices/generate` over `/admin/v2/invoices/:id`.
    const order = (path: string) => routes.indexOf(path);
    expect(order('POST /api/properties/search')).toBeLessThan(
      order('POST /api/properties/:id'),
    );
    expect(order('POST /admin/v2/invoices/generate')).toBeLessThan(
      order('POST /admin/v2/invoices'),
    );
  });

  it('registers no duplicate method+path pairs', () => {
    const seen = new Set<string>();
    const duplicates = routes.filter((r) => (seen.has(r) ? true : (seen.add(r), false)));
    expect(duplicates).toEqual([]);
  });
});
