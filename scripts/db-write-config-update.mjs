import {readFileSync,writeFileSync,readdirSync} from "node:fs";
const suffix="configuration_media_controls";
const path="supabase/migrations/"+readdirSync("supabase/migrations").find(f=>f.endsWith(`_${suffix}.sql`));
if(readFileSync(path,"utf8").trim())throw new Error("Refusing to overwrite a non-empty migration.");
let sql=readFileSync("supabase/config-editors.sql","utf8")+"\n"+readFileSync("supabase/video.sql","utf8");
for(const file of ["functions.sql","editors.sql"]) {
  const contents=readFileSync("supabase/"+file,"utf8");
  // Only affected functions are redefined; earlier immutable migrations stay fixed.
  const functions=contents.match(/CREATE FUNCTION[\s\S]*?\$\$;/g)??[];
  sql+="\n"+functions.filter(f=>/CREATE FUNCTION app\.(money_json|staff_edit|approve_translation)\(/.test(f)).join("\n");
}
sql=sql.replaceAll("CREATE FUNCTION","CREATE OR REPLACE FUNCTION");
writeFileSync(path,sql);
console.log("Wrote configuration/media forward migration.");
