import { Pool, type PoolClient, type PoolConfig, type QueryResultRow } from "pg";

export type ActorContext = {type: "staff" | "guest" | "system"; id?: string; sessionHash?: string};
export type Transaction = PoolClient;
const globalDb = globalThis as typeof globalThis & {tourismPool?: Pool};
function poolConfiguration():PoolConfig {
  const configuration:PoolConfig={connectionString:process.env.DATABASE_URL,max:10,idleTimeoutMillis:30_000,connectionTimeoutMillis:5_000};
  const ca=process.env.DATABASE_SSL_CA?.trim();
  if(!["staging","production"].includes(process.env.APP_ENV??"")&&!ca)return configuration;
  if(configuration.connectionString){
    let url:URL;
    try{url=new URL(configuration.connectionString);}catch{throw new Error("DATABASE_URL_INVALID");}
    // pg URL SSL parameters replace its entire ssl object, including the trusted CA.
    for(const [key,value] of url.searchParams){
      if((key.startsWith("ssl")||key==="uselibpqcompat")&&!(key==="sslmode"&&value==="verify-full"))throw new Error("DATABASE_TLS_OPTIONS_CONFLICT");
    }
    url.searchParams.delete("sslmode");configuration.connectionString=url.toString();
  }
  configuration.ssl={rejectUnauthorized:true,...(ca?{ca}: {})};
  return configuration;
}
export const pool = globalDb.tourismPool ?? new Pool(poolConfiguration());
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
