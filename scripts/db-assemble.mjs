// Development assembly only. Applied migration checksums are never modified by db:migrate.
import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
const files=['core.sql','extensions.sql','functions.sql','payments.sql','workflows.sql','security.sql'];
let sql=files.map(f=>readFileSync(`supabase/${f}`,'utf8')).join('\n');
// Decimal strings at every JSON boundary; PostgreSQL calculations remain bigint.
sql=sql.replaceAll('RETURN to_jsonb(b);','RETURN app.money_json(to_jsonb(b));')
 .replaceAll('RETURN to_jsonb(a);','RETURN app.money_json(to_jsonb(a));')
 .replaceAll('RETURN to_jsonb(r);','RETURN app.money_json(to_jsonb(r));')
 .replaceAll("RETURN to_jsonb(q)||jsonb_build_object('items',items);","RETURN app.money_json(to_jsonb(q)||jsonb_build_object('items',items));");
// Keep original booking-item history after revisions; allocate only current items.
sql=sql.replaceAll('WHERE i.booking_id=b.id ORDER BY','WHERE i.booking_id=b.id AND i.superseded_at IS NULL ORDER BY')
 .replaceAll('WHERE i.booking_id=b.id)', 'WHERE i.booking_id=b.id AND i.superseded_at IS NULL)')
 .replaceAll("WHERE i.booking_id=b.id AND i.kind IN('transfer','photography')","WHERE i.booking_id=b.id AND i.superseded_at IS NULL AND i.kind IN('transfer','photography')");
sql+='\nGRANT EXECUTE ON FUNCTION app.consume_rate_limit(text,text,integer,integer),app.asset_publication_eligible(uuid),app.assert_public_gallery(uuid),app.assert_public_asset(uuid),app.money_json(jsonb) TO tourism_app;\n';
const name=readdirSync('supabase/migrations').find(f=>f.endsWith('_tourism_core.sql'));
if(!name)throw new Error('Generate migration with inspected Supabase CLI first.');
writeFileSync(`supabase/migrations/${name}`,sql);
console.log(`Assembled ${name}`);
