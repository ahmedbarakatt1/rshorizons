import {readFileSync,writeFileSync,readdirSync} from "node:fs";
const suffix="configuration_security_guards";
const path="supabase/migrations/"+readdirSync("supabase/migrations").find(f=>f.endsWith(`_${suffix}.sql`));
if(readFileSync(path,"utf8").trim())throw new Error("Refusing to overwrite a non-empty migration.");
let sql=readFileSync("supabase/final-guards.sql","utf8");
for(const file of ["functions.sql","config-editors.sql"]) {
 const functions=readFileSync("supabase/"+file,"utf8").match(/CREATE FUNCTION[\s\S]*?\$\$;/g)??[];
 sql+="\n"+functions.filter(f=>/CREATE FUNCTION app\.(create_quote|staff_config_edit)\(/.test(f)).join("\n");
}
sql=sql.replaceAll("CREATE FUNCTION","CREATE OR REPLACE FUNCTION")
 .replaceAll("RETURN to_jsonb(q)||jsonb_build_object('items',items);","RETURN app.money_json(to_jsonb(q)||jsonb_build_object('items',items));");
writeFileSync(path,sql);
console.log("Wrote configuration/security forward migration.");
