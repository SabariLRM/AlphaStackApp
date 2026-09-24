import pg from 'pg';

export type Db = pg.Pool;
export type DbClient = pg.Pool | pg.PoolClient;

// Keep timestamps as JS Dates and bigint counts as numbers (counts here never exceed 2^53).
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));

export function createPool(connectionString: string): Db {
  return new pg.Pool({ connectionString, max: 15, idleTimeoutMillis: 30_000 });
}

export async function withTransaction<T>(pool: Db, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export async function one<T extends pg.QueryResultRow>(db: DbClient, sql: string, params: unknown[] = []): Promise<T | undefined> {
  const res = await db.query<T>(sql, params);
  return res.rows[0];
}

export async function many<T extends pg.QueryResultRow>(db: DbClient, sql: string, params: unknown[] = []): Promise<T[]> {
  const res = await db.query<T>(sql, params);
  return res.rows;
}
