// Local development iteration only; final forward migrations carry all changed functions.
import {readFileSync} from 'node:fs';
import pg from 'pg';
try{process.loadEnvFile('.env.local');}catch { /* CI may provide environment variables without a local file. */ }
const url=new URL(process.env.MIGRATION_DATABASE_URL);
if(url.hostname!=='127.0.0.1'||process.env.APP_ENV==='production')throw new Error('Local development only.');
const db=new pg.Client({connectionString:url.toString()});await db.connect();
try{
 let sql=['functions.sql','payments.sql','workflows.sql'].map(f=>readFileSync(`supabase/${f}`,'utf8')).join('\n').replaceAll('CREATE FUNCTION','CREATE OR REPLACE FUNCTION');
 sql=sql.replaceAll('RETURN to_jsonb(b);','RETURN app.money_json(to_jsonb(b));').replaceAll('RETURN to_jsonb(a);','RETURN app.money_json(to_jsonb(a));').replaceAll('RETURN to_jsonb(r);','RETURN app.money_json(to_jsonb(r));').replaceAll("RETURN to_jsonb(q)||jsonb_build_object('items',items);","RETURN app.money_json(to_jsonb(q)||jsonb_build_object('items',items));")
 .replaceAll('WHERE i.booking_id=b.id ORDER BY','WHERE i.booking_id=b.id AND i.superseded_at IS NULL ORDER BY').replaceAll('WHERE i.booking_id=b.id)', 'WHERE i.booking_id=b.id AND i.superseded_at IS NULL)').replaceAll("WHERE i.booking_id=b.id AND i.kind IN('transfer','photography')","WHERE i.booking_id=b.id AND i.superseded_at IS NULL AND i.kind IN('transfer','photography')");
 const guards=readFileSync('supabase/security.sql','utf8').match(/CREATE FUNCTION[\s\S]*?\$\$;/g)??[];
 sql+='\n'+guards.join('\n').replaceAll('CREATE FUNCTION','CREATE OR REPLACE FUNCTION');
 await db.query(sql);console.log('Local transactional function iteration applied.');
}finally{await db.end();}
