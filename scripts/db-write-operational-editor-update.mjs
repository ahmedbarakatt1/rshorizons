import {readFileSync,writeFileSync} from "node:fs";
const path="supabase/migrations/20261020170000_operational_editor_details.sql";
const source=readFileSync("supabase/editors.sql","utf8");
const fn=source.match(/CREATE FUNCTION app\.staff_edit\([\s\S]*?\$\$;/)?.[0];
if(!fn)throw new Error("Staff editor definition missing");
const sql="ALTER TABLE app.apartments ADD COLUMN IF NOT EXISTS cancellation_policy_version_id uuid REFERENCES app.policy_versions(id);\n"+
fn.replace("CREATE FUNCTION","CREATE OR REPLACE FUNCTION")+"\n";
writeFileSync(path,sql,{flag:"wx"});
