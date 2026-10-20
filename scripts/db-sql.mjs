import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
try {process.loadEnvFile('.env.local');} catch { /* CI may provide environment variables without a local file. */ }
const u=new URL(process.env.MIGRATION_DATABASE_URL);
const r=spawnSync(process.env.PSQL_BIN || 'C:/Program Files/PostgreSQL/17/bin/psql.exe',['-X','-v','ON_ERROR_STOP=1'],{encoding:'utf8',windowsHide:true,input:readFileSync(process.argv[2],'utf8'),env:{...process.env,PGHOST:u.hostname,PGPORT:u.port,PGUSER:u.username,PGPASSWORD:u.password,PGDATABASE:u.pathname.slice(1)}});
process.stdout.write(r.stdout||'');process.stderr.write(r.stderr||'');process.exit(r.status||0);
