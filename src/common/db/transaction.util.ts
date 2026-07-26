import { Logger } from '@nestjs/common';
import { ClientSession, Connection } from 'mongoose';

const logger = new Logger('Transaction');

/**
 * True when the error indicates the current MongoDB topology doesn't support
 * multi-document transactions (e.g. a standalone dev instance rather than a replica set).
 */
function isTransactionUnsupported(err: any): boolean {
  const msg = String(err?.message ?? '');
  return (
    /Transaction numbers are only allowed on a replica set/i.test(msg) ||
    /Transactions are not supported/i.test(msg) ||
    /This MongoDB deployment does not support retryable writes/i.test(msg) ||
    err?.code === 20 ||
    err?.codeName === 'IllegalOperation'
  );
}

/**
 * audit C-4: run `work` inside a MongoDB transaction so multi-collection writes
 * (payment state, cascade deletes) commit atomically or roll back together.
 *
 * Production runs as a replica set (MONGO_REPLICASET) so transactions are available.
 * On a standalone dev instance transactions aren't supported; in that case we log once
 * and fall back to running the same work without a session (best-effort, non-atomic) so
 * local development keeps working. Pass `session` through to every query in `work`.
 */
export async function runInTransaction<T>(
  connection: Connection,
  work: (session: ClientSession | undefined) => Promise<T>,
): Promise<T> {
  const session = await connection.startSession();
  try {
    let result: T;
    await session.withTransaction(async () => {
      result = await work(session);
    });
    return result!;
  } catch (err) {
    if (isTransactionUnsupported(err)) {
      logger.warn(
        'MongoDB transactions unsupported on this topology — running non-atomically. ' +
          'Use a replica set in production (MONGO_REPLICASET).',
      );
      return work(undefined);
    }
    throw err;
  } finally {
    await session.endSession();
  }
}
