import {beforeAll, afterAll, expect, test} from "vitest";
import pg from "pg";
try{process.loadEnvFile(".env.local");}catch { /* CI may provide environment variables without a local file. */ }
const db=new pg.Client({connectionString:process.env.MIGRATION_DATABASE_URL});
beforeAll(async()=>{await db.connect();});
afterAll(async()=>{await db.end();});
test("required_relational_schema_exists",async()=>{
  const result=await db.query("SELECT table_name FROM information_schema.tables WHERE table_schema='app'");
  const tables=result.rows.map(r=>r.table_name);
  expect(tables).toEqual(expect.arrayContaining(["bookings","quotes","apartment_inventory","capacity_allocations","cash_ledger","jobs","staff_scopes"]));
});
test("unified_apartment_exclusion_is_enforced",async()=>{
  const r=await db.query("SELECT pg_get_constraintdef(oid) definition FROM pg_constraint WHERE contype='x' AND conrelid=to_regclass('app.apartment_inventory')");
  expect(r.rows[0]?.definition).toContain("date_range WITH &&");
});
test("all_private_tables_have_rls",async()=>{
  expect(Number((await db.query("SELECT count(*) n FROM pg_tables WHERE schemaname='app'")).rows[0].n)).toBeGreaterThan(80);
  const r=await db.query("SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='app' AND c.relkind='r' AND NOT c.relrowsecurity");
  expect(r.rows).toEqual([]);
});
