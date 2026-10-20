import pg from 'pg';
import {readFileSync} from 'node:fs';
try {process.loadEnvFile('.env.local');} catch { /* CI may provide environment variables without a local file. */ }
if(process.env.APP_ENV==='production'||process.env.NODE_ENV==='production')throw new Error('Synthetic seed forbidden in production.');
const url=new URL(process.env.MIGRATION_DATABASE_URL||'');
if(!['localhost','127.0.0.1'].includes(url.hostname)&&process.env.ALLOW_SYNTHETIC_SEED!=='true')throw new Error('Nonlocal seed requires ALLOW_SYNTHETIC_SEED=true.');
const db=new pg.Client({connectionString:url.toString()});await db.connect();
try{await db.query('BEGIN');await db.query(readFileSync('supabase/seed.sql','utf8'));await db.query('COMMIT');console.log('Synthetic catalog seeded; no staff passwords or reviews.');}
catch(error){await db.query('ROLLBACK');throw error;}finally{await db.end();}
