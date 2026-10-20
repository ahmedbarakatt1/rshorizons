import pg from 'pg';
import {writeFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
if(process.env.CI!=='true'||process.env.APP_ENV==='production')throw new Error('CI-only bootstrap.');
const migrator=new URL(process.env.MIGRATION_DATABASE_URL);
if(migrator.hostname!=='127.0.0.1'||migrator.pathname!=='/tourism_ci')throw new Error('CI database must be isolated loopback tourism_ci.');
const password=randomBytes(32).toString('hex');
const db=new pg.Client({connectionString:migrator.toString()});await db.connect();
try{await db.query(`CREATE ROLE tourism_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS PASSWORD '${password}'`);}finally{await db.end();}
const runtime=new URL(migrator);runtime.username='tourism_app';runtime.password=password;
console.log(`::add-mask::${password}`);
writeFileSync('.env.local',[
 `APP_ENV=test`,`DEMO_MODE=true`,`BOOKING_ENABLED=true`,`APP_BASE_URL=http://127.0.0.1:3000`,
 `MIGRATION_DATABASE_URL=${migrator.toString()}`,`DATABASE_URL=${runtime.toString()}`,
 `TOKEN_HASH_PEPPER=${randomBytes(32).toString('hex')}`,`CRON_SECRET=${randomBytes(32).toString('hex')}`,
 `STORAGE_PROVIDER=local`,`PAYMOB_MODE=local`,`EMAIL_PROVIDER=local`,`VIDEO_PROVIDER=local`,
 `TEST_RECIPIENT_ALLOWLIST=guest@example.invalid`
].join('\n')+'\n',{mode:0o600});
console.log('Isolated CI credentials generated; no production secrets loaded.');
