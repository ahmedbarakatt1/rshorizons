import {readFileSync,writeFileSync,readdirSync} from "node:fs";
const [suffix,names]=process.argv.slice(2);
if(!/^[a-z_]+$/.test(suffix??"")||!names?.split(",").every(n=>/^[a-z_]+$/.test(n)))throw new Error("Suffix and comma-separated function names required.");
const selected=new Set(names.split(","));
const path="supabase/migrations/"+readdirSync("supabase/migrations").find(f=>f.endsWith(`_${suffix}.sql`));
if(readFileSync(path,"utf8").trim())throw new Error("Refusing to overwrite a non-empty migration.");
const found=new Set(),chunks=[];
for(const file of ["functions.sql","payments.sql","workflows.sql","security.sql","editors.sql","config-editors.sql","final-guards.sql"]) {
 for(const fn of readFileSync("supabase/"+file,"utf8").match(/CREATE FUNCTION[\s\S]*?\$\$;/g)??[]) {
  const name=/CREATE FUNCTION app\.([a-z_]+)\(/.exec(fn)?.[1];
  if(selected.has(name)){chunks.push(fn);found.add(name);}
 }
}
if(found.size!==selected.size)throw new Error("Missing selected function definition.");
const sql=chunks.join("\n").replaceAll("CREATE FUNCTION","CREATE OR REPLACE FUNCTION")
 .replaceAll("RETURN to_jsonb(q)||jsonb_build_object('items',items);","RETURN app.money_json(to_jsonb(q)||jsonb_build_object('items',items));")
 .replaceAll("RETURN to_jsonb(b);","RETURN app.money_json(to_jsonb(b));")
 .replaceAll("RETURN to_jsonb(a);","RETURN app.money_json(to_jsonb(a));")
 .replaceAll("RETURN to_jsonb(r);","RETURN app.money_json(to_jsonb(r));");
writeFileSync(path,sql);
console.log(`Wrote ${selected.size} selected function updates.`);
