import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
let sql=['functions.sql','payments.sql','workflows.sql'].map(f=>readFileSync(`supabase/${f}`,'utf8')).join('\n').replaceAll('CREATE FUNCTION','CREATE OR REPLACE FUNCTION');
sql=sql.replaceAll('RETURN to_jsonb(b);','RETURN app.money_json(to_jsonb(b));').replaceAll('RETURN to_jsonb(a);','RETURN app.money_json(to_jsonb(a));').replaceAll('RETURN to_jsonb(r);','RETURN app.money_json(to_jsonb(r));').replaceAll("RETURN to_jsonb(q)||jsonb_build_object('items',items);","RETURN app.money_json(to_jsonb(q)||jsonb_build_object('items',items));")
.replaceAll('WHERE i.booking_id=b.id ORDER BY','WHERE i.booking_id=b.id AND i.superseded_at IS NULL ORDER BY').replaceAll('WHERE i.booking_id=b.id)', 'WHERE i.booking_id=b.id AND i.superseded_at IS NULL)').replaceAll("WHERE i.booking_id=b.id AND i.kind IN('transfer','photography')","WHERE i.booking_id=b.id AND i.superseded_at IS NULL AND i.kind IN('transfer','photography')");
const guards=readFileSync('supabase/security.sql','utf8').match(/CREATE FUNCTION[\s\S]*?\$\$;/g)??[];
sql+='\n'+guards.join('\n').replaceAll('CREATE FUNCTION','CREATE OR REPLACE FUNCTION');
sql+='\n'+readFileSync('supabase/evolution.sql','utf8');
const file=readdirSync('supabase/migrations').find(f=>f.endsWith('_transaction_hardening.sql'));
if(!file)throw new Error('Create migration through Supabase CLI first');
writeFileSync('supabase/migrations/'+file,sql);console.log('Wrote forward migration '+file);
