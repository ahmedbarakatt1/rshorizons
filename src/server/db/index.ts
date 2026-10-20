import { Pool, type PoolClient, type QueryResultRow } from "pg";

export type ActorContext = {type: "staff" | "guest" | "system"; id?: string; sessionHash?: string};
export type Transaction = PoolClient;
const globalDb = globalThis as typeof globalThis & {tourismPool?: Pool};
export const pool = globalDb.tourismPool ?? new Pool({connectionString: process.env.DATABASE_URL, max: 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000});
if (process.env.NODE_ENV !== "production") globalDb.tourismPool = pool;
export async function query<T extends QueryResultRow = QueryResultRow>(sql: string, values: unknown[] = []) {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL_REQUIRED");
  return pool.query<T>(sql, values);
}
export async function withTransaction<T>(actor: ActorContext, operation: (tx: Transaction) => Promise<T>): Promise<T> {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL_REQUIRED");
  for (let attempt = 0; attempt < 3; attempt++) {
    const tx = await pool.connect();
    try {
      await tx.query("BEGIN");
      await tx.query("SELECT set_config('app.actor_type',$1,true),set_config('app.actor_id',$2,true),set_config('app.session_hash',$3,true)", [actor.type, actor.id ?? "", actor.sessionHash ?? ""]);
      await tx.query("SET LOCAL statement_timeout = '15s'");
      const result = await operation(tx);
      await tx.query("COMMIT");
      return result;
    } catch (error) {
      await tx.query("ROLLBACK");
      const code = (error as {code?: string}).code;
      if (attempt === 2 || !["40001", "40P01"].includes(code ?? "")) throw error;
    } finally { tx.release(); }
  }
  throw new Error("TRANSACTION_RETRY_EXHAUSTED");
}
