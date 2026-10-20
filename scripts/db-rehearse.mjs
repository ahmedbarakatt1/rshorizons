import pg from 'pg';
import {readFileSync,readdirSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {resolve,join} from 'node:path';
try{process.loadEnvFile('.env.local');}catch { /* CI may provide environment variables without a local file. */ }
const url=new URL(process.env.MIGRATION_DATABASE_URL);
if(url.hostname!=='127.0.0.1'||url.port!=='55432'||process.env.APP_ENV==='production')throw new Error('Rehearsal only permitted against isolated local cluster.');
const prefix=`tourism_rehearsal_${Date.now()}`,restored=prefix+'_restored';
const main=new pg.Client({connectionString:url.toString()});await main.connect();
const testUrl=new URL(url);testUrl.pathname='/'+prefix;
const runtimeUrl=new URL(process.env.DATABASE_URL);runtimeUrl.pathname='/'+prefix;
const restoreUrl=new URL(url);restoreUrl.pathname='/'+restored;
mkdirSync('docs/evidence',{recursive:true});mkdirSync('.local/rehearsals',{recursive:true});
try{
 await main.query(`CREATE DATABASE "${prefix}"`);await main.query(`CREATE DATABASE "${restored}"`);
 const db=new pg.Client({connectionString:testUrl.toString()});await db.connect();
 try{
  await db.query('CREATE SCHEMA migration;CREATE TABLE migration.applied(version text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())');
  for(const file of readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort()){
   const sql=readFileSync('supabase/migrations/'+file,'utf8');if(!sql.trim())continue;
   await db.query('BEGIN');try{await db.query(sql);await db.query('INSERT INTO migration.applied(version,checksum) VALUES($1,$2)',[file,createHash('sha256').update(sql).digest('hex')]);await db.query('COMMIT');}catch(e){await db.query('ROLLBACK');throw e;}
  }
  await db.query(readFileSync('supabase/seed.sql','utf8'));
 }finally{await db.end();}
 const tests=spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run','tests/database','tests/concurrency'],{encoding:'utf8',windowsHide:true,maxBuffer:8*1024*1024,env:{...process.env,MIGRATION_DATABASE_URL:testUrl.toString(),DATABASE_URL:runtimeUrl.toString()}});
 writeFileSync('docs/evidence/database-clean-rehearsal.log',(tests.stdout||'')+(tests.stderr||'')+`\nExit code: ${tests.status}\n`);
 if(tests.status!==0)throw new Error('Clean database tests failed; inspect database-clean-rehearsal.log');
 const patched=resolve('.tooling/postgresql-17.11/pgsql/bin');
 const bin=process.env.POSTGRES_BIN||(existsSync(join(patched,'pg_dump.exe'))?patched:'C:/Program Files/PostgreSQL/17/bin');
 const dump=resolve('.local/rehearsals',prefix+'.dump');
 const cmd=(name,args,database)=>{const p=spawnSync(join(bin,name+'.exe'),args,{encoding:'utf8',windowsHide:true,env:{...process.env,PGHOST:url.hostname,PGPORT:url.port,PGUSER:url.username,PGPASSWORD:url.password,PGDATABASE:database}});if(p.status!==0)throw new Error(name+' failed: '+p.stderr);};
 cmd('pg_dump',['--format=custom','--file',dump],prefix);
 cmd('pg_restore',['--exit-on-error','--dbname',restored,dump],restored);
 const original=new pg.Client({connectionString:testUrl.toString()}),copy=new pg.Client({connectionString:restoreUrl.toString()});await original.connect();await copy.connect();
 let checks;
 try{
  const query="SELECT (SELECT count(*) FROM app.bookings)::int bookings,(SELECT count(*) FROM app.cash_ledger)::int ledger,(SELECT count(*) FROM app.outbox_events)::int outbox,(SELECT count(*) FROM pg_tables WHERE schemaname='app')::int tables";
  const source=(await original.query(query)).rows[0],destination=(await copy.query(query)).rows[0];
  if(JSON.stringify(source)!==JSON.stringify(destination))throw new Error('Restore record counts differ.');
  checks={source,destination,postgres:(await copy.query('SELECT version() v')).rows[0].v};
 }finally{await original.end();await copy.end();}
 const report={createdAt:new Date().toISOString(),database:prefix,restoredDatabase:restored,checks,testsExitCode:tests.status,storageRestore:'BLOCKED_EXTERNAL: no external object store provisioned',note:'Only isolated synthetic databases created; main tourism DB was not reset or dropped.'};
 writeFileSync('docs/evidence/database-restore.json',JSON.stringify(report,null,2));
 writeFileSync('.local/rehearsals/latest.json',JSON.stringify({database:prefix,restoredDatabase:restored,dump},null,2));
 console.log('Clean migration, concurrency suite, pg_dump/pg_restore verified on isolated databases. See docs/evidence/database-restore.json.');
}finally{await main.end();}
