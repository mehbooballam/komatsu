import { Pool, types } from "pg";

// Return DATE columns (type 1082) as plain "YYYY-MM-DD" strings. By default pg turns
// them into a JS Date at local midnight, which shifts the day when serialised to JSON
// in time zones ahead of UTC (e.g. a 15 Jan deadline showed as 14 Jan).
types.setTypeParser(1082, (value: string) => value);

/** Parse a "YYYY-MM-DD" date (or Date) as a local calendar date. */
export function parseDateOnly(value: string | Date): Date {
  if (value instanceof Date) return value;
  const [y, m, d] = value.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export async function query(text: string, params?: unknown[]) {
  const client = await pool.connect();
  try {
    const result = await client.query(text, params);
    return result;
  } finally {
    client.release();
  }
}

export async function getClient() {
  return pool.connect();
}

export async function transaction<T>(
  fn: (client: import("pg").PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export default pool;
