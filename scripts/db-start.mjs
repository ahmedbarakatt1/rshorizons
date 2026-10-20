import {spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {mkdirSync, existsSync, readFileSync, writeFileSync, unlinkSync} from 'node:fs';
import {resolve, join} from 'node:path';
import net from 'node:net';

const root=resolve(import.meta.dirname,'..');
const local=join(root,'.local','postgres');
const data=join(local,'data');
const patched=join(root,'.tooling','postgresql-17.11','pgsql','bin');
const bin=process.env.POSTGRES_BIN || (existsSync(join(patched,'postgres.exe'))?patched:(process.platform==='win32'?'C:\\Program Files\\PostgreSQL\\17\\bin':''));
const exe=name=>bin?join(bin,name+(process.platform==='win32'?'.exe':'')):name;
mkdirSync(local,{recursive:true});
const envFile=join(root,'.env.local');
let envText=existsSync(envFile)?readFileSync(envFile,'utf8'):'';
const envValue=name=>envText.match(new RegExp(`^${name}=(.*)$`,'m'))?.[1]?.trim();
const run=(name,args,env={},input)=> {
  const r=spawnSync(exe(name),args,{encoding:'utf8',windowsHide:true,env:{...process.env,...env},input, ...(name==='pg_ctl'&&args.includes('start')?{stdio:'ignore'}:{})});
  if(r.status!==0) throw new Error(`${name} failed (${r.status}): ${r.stderr || r.stdout}`);
  return r.stdout;
};
const available=port=>new Promise(resolve=>{const s=net.createServer();s.once('error',()=>resolve(false));s.listen(port,'127.0.0.1',()=>s.close(()=>resolve(true)));});
let url=envValue('MIGRATION_DATABASE_URL');
if(!existsSync(join(data,'PG_VERSION'))) {
  let port=55432; while(!await available(port)) port++;
  if(port>55450) throw new Error('No isolated PostgreSQL port available.');
  const admin=randomBytes(32).toString('hex'), app=randomBytes(32).toString('hex');
  const pw=join(local,'init-password.tmp');
  writeFileSync(pw,admin,{mode:0o600});
  try {run('initdb',['-D',data,'-U','tourism_migrator','--pwfile',pw,'--auth=scram-sha-256','--encoding=UTF8','--locale=C']);}
  finally {unlinkSync(pw);}
  writeFileSync(join(data,'postgresql.conf'),`\nlisten_addresses = '127.0.0.1'\nport = ${port}\nmax_connections = 40\nshared_buffers = '64MB'\nlog_statement = 'none'\n`,{flag:'a'});
  url=`postgresql://tourism_migrator:${admin}@127.0.0.1:${port}/tourism`;
  envText += `\n# Isolated local development PostgreSQL; generated credentials, never commit.\nMIGRATION_DATABASE_URL=${url}\nDATABASE_URL=postgresql://tourism_app:${app}@127.0.0.1:${port}/tourism\n`;
  writeFileSync(envFile,envText,{mode:0o600});
}
if(!url) throw new Error('Existing local cluster requires its original .env.local credentials.');
const u=new URL(url);
if(u.hostname!=='127.0.0.1'||!u.port||u.pathname!=='/tourism') throw new Error('Refusing to start outside isolated local tourism cluster.');
const state=spawnSync(exe('pg_ctl'),['-D',data,'status'],{encoding:'utf8',windowsHide:true});
if(state.status!==0)run('pg_ctl',['-D',data,'-l',join(local,'server.log'),'-w','start']);
const conn={PGHOST:u.hostname,PGPORT:u.port,PGUSER:decodeURIComponent(u.username),PGPASSWORD:decodeURIComponent(u.password),PGDATABASE:'postgres'};
const dbExists=run('psql',['-X','-tAc',"SELECT 1 FROM pg_database WHERE datname='tourism'"],conn).trim();
if(!dbExists)run('createdb',['tourism'],conn);
const appUrl=new URL(envValue('DATABASE_URL') || envText.match(/^DATABASE_URL=(.*)$/m)[1]);
const appPassword=decodeURIComponent(appUrl.password);
if(!/^[a-f0-9]{64}$/.test(appPassword)) throw new Error('Local runtime credential format invalid.');
run('psql',['-X','-v','ON_ERROR_STOP=1','-q'],{...conn,PGDATABASE:'tourism'},`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='tourism_app') THEN CREATE ROLE tourism_app LOGIN PASSWORD '${appPassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS; END IF; END $$;`);
console.log(`Isolated PostgreSQL ready on loopback port ${u.port}; database tourism; credentials in ignored .env.local.`);
