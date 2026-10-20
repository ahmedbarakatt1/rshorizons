import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
const suffix=process.argv[2];if(!suffix||!/^[a-z_]+$/.test(suffix))throw new Error('Migration suffix required.');
const path=readdirSync('supabase/migrations').find(f=>f.endsWith(`_${suffix}.sql`));if(!path)throw new Error('Generate with Supabase CLI first.');
if(readFileSync('supabase/migrations/'+path,'utf8').trim())throw new Error('Refusing to overwrite a non-empty migration.');
let sql=['functions.sql','payments.sql','workflows.sql'].map(f=>readFileSync('supabase/'+f,'utf8')).join('\n');
for(const f of ['security.sql','editors.sql']) sql+='\n'+(readFileSync('supabase/'+f,'utf8').match(/CREATE FUNCTION[\s\S]*?\$\$;/g)||[]).join('\n');
sql=sql.replaceAll('CREATE FUNCTION','CREATE OR REPLACE FUNCTION').replaceAll('RETURN to_jsonb(b);','RETURN app.money_json(to_jsonb(b));').replaceAll('RETURN to_jsonb(a);','RETURN app.money_json(to_jsonb(a));').replaceAll('RETURN to_jsonb(r);','RETURN app.money_json(to_jsonb(r));').replaceAll("RETURN to_jsonb(q)||jsonb_build_object('items',items);","RETURN app.money_json(to_jsonb(q)||jsonb_build_object('items',items));")
.replaceAll('WHERE i.booking_id=b.id ORDER BY','WHERE i.booking_id=b.id AND i.superseded_at IS NULL ORDER BY').replaceAll('WHERE i.booking_id=b.id)', 'WHERE i.booking_id=b.id AND i.superseded_at IS NULL)').replaceAll("WHERE i.booking_id=b.id AND i.kind IN('transfer','photography')","WHERE i.booking_id=b.id AND i.superseded_at IS NULL AND i.kind IN('transfer','photography')");
sql+='\nREVOKE ALL ON FUNCTION app.retry_job(uuid,uuid) FROM PUBLIC,anon,authenticated;\nGRANT EXECUTE ON FUNCTION app.retry_job(uuid,uuid) TO tourism_app;\n';
writeFileSync('supabase/migrations/'+path,sql);console.log(`Wrote ${path}`);
