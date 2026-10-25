import {expect,it} from "vitest";
import {supabaseSchedulerSql} from "../../scripts/lib/supabase-scheduler";
it("preserves all job cadences and installs them paused without embedding credentials",()=>{
  const sql=supabaseSchedulerSql("https://rshorizons.vercel.app","production");
  expect(sql).toContain("'* * * * *'");expect(sql).toContain("'*/5 * * * *'");expect(sql).toContain("'30 2 * * *'");
  for(const job of ["worker","monitor","retention"]){
    expect(sql).toContain(`/api/internal/${job}`);expect(sql).toContain(`rsh-production-${job}`);
  }
  expect(sql.match(/active := false/g)).toHaveLength(3);
  expect(sql).toContain("rsh_production_cron_secret");
  expect(sql).toContain("vault.decrypted_secrets");
  expect(sql).toContain("timeout_milliseconds := 300000");
  expect(sql).toContain("BEGIN;");expect(sql.trimEnd().endsWith("COMMIT;")).toBe(true);
  expect(sql).not.toContain("CREATE EXTENSION");
});
it("isolates staging names from production",()=>{
  const sql=supabaseSchedulerSql("https://staging.example.test","staging");
  expect(sql).toContain("rsh-staging-worker");expect(sql).toContain("rsh_staging_cron_secret");expect(sql).not.toContain("rsh-production");
});
it.each(["http://example.com","https://localhost","https://127.0.0.1","https://example.com/path","https://example.com?token=x","https://user:pass@example.com","https://example.com/#x","https://example.com:444","https://bad'.example.com"])("rejects an unsafe or noncanonical origin: %s",origin=>{
  expect(()=>supabaseSchedulerSql(origin,"production")).toThrow();
});
