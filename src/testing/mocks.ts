/**
 * Shared test doubles for module-wise unit specs. No database required:
 * services are constructed directly with these fakes standing in for
 * Mongoose models. Excluded from `nest build` via tsconfig.build.json.
 */

/**
 * Chainable Mongoose Query mock. Every chain method is a jest.fn returning the
 * same query (so calls/args can be asserted); the query is awaitable directly
 * (thenable) AND via .exec(), matching both call styles used in the services.
 */
export const mockQuery = (result: any) => {
  const query: any = {};
  for (const name of ['select', 'lean', 'populate', 'sort', 'limit', 'skip']) {
    query[name] = jest.fn(() => query);
  }
  query.exec = jest.fn(() => Promise.resolve(result));
  query.then = (onFulfilled: any, onRejected: any) =>
    Promise.resolve(result).then(onFulfilled, onRejected);
  return query;
};

/** Lets fire-and-forget (`void asyncFn()`) work settle before assertions. */
export const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 25));

/**
 * Mongoose Connection mock for services that use runInTransaction (audit C-4).
 * startSession() returns a session whose withTransaction just runs the callback,
 * so cascade-delete work executes synchronously in tests with a stub session.
 */
export const mockConnection = () => {
  const session: any = { endSession: jest.fn() };
  session.withTransaction = jest.fn(async (fn: any) => {
    await fn();
  });
  return {
    startSession: jest.fn().mockResolvedValue(session),
    _session: session,
  } as any;
};

/** An admin user object shaped like req.user (JwtStrategy attaches the doc with populated role). */
export const userWithPermissions = (permissions: string[], id = '507f1f77bcf86cd799439011') => ({
  _id: id,
  email: 'admin@test.com',
  role: { _id: '507f1f77bcf86cd799439022', permissions },
});
