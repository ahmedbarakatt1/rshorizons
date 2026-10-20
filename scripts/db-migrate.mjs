import {readFileSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import pg from 'pg';
try {process.loadEnvFile('.env.local');} catch { /* CI may provide environment variables without a local file. */ }
if(!process.env.MIGRATION_DATABASE_URL)throw new Error('MIGRATION_DATABASE_URL required.');
const db=new pg.Client({connectionString:process.env.MIGRATION_DATABASE_URL});
await db.connect();
try {
  await db.query('CREATE SCHEMA IF NOT EXISTS migration; CREATE TABLE IF NOT EXISTS migration.applied(version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
  for(const file of readdirSync(resolve('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort()){
    const sql=readFileSync(resolve('supabase/migrations',file),'utf8'), checksum=createHash('sha256').update(sql).digest('hex');
    if(!sql.trim()){console.log(`Skipped empty in-progress migration ${file}`);continue;}
    const old=await db.query('SELECT checksum FROM migration.applied WHERE version=$1',[file]);
    if(old.rowCount){if(old.rows[0].checksum!==checksum)throw new Error(`Applied migration drift: ${file}`);continue;}
    await db.query('BEGIN');
    try {await db.query(sql);await db.query('INSERT INTO migration.applied(version,checksum) VALUES($1,$2)',[file,checksum]);await db.query('COMMIT');console.log(`Applied ${file}`);}
    catch(error){await db.query('ROLLBACK');throw error;}
  }
} finally {await db.end();}
