import {writeFileSync,mkdirSync} from "node:fs";
import {supabaseSchedulerSql} from "./lib/supabase-scheduler";
const [environment,origin]=process.argv.slice(2);
if((environment!=="staging"&&environment!=="production")||!origin){
  console.error("Usage: npx --no-install tsx scripts/prepare-supabase-scheduler.ts staging|production https://designated-host");
  process.exitCode=1;
}else{
  const sql=supabaseSchedulerSql(origin,environment);
  mkdirSync(".local",{recursive:true});
  const path=`.local/supabase-scheduler-${environment}.sql`;
  writeFileSync(path,sql,{mode:0o600});
  console.log(`Prepared ${path}. No network requests, secrets copied or schedules activated. Review docs/runbooks/external-scheduler.md before installation.`);
}
