import {expect,test} from "vitest";
import {randomBytes} from "node:crypto";
import {spawnSync} from "node:child_process";
import pg from "pg";

test("fresh migrations preserve managed Auth without CREATE privileges on its schema",async()=>{
  const operatorUrl=new URL(process.env.MIGRATION_DATABASE_URL!);
  if(!["127.0.0.1","localhost"].includes(operatorUrl.hostname))throw new Error("Isolated loopback PostgreSQL required");
  const suffix=randomBytes(6).toString("hex"),name=`hosted_migration_${suffix}`,password=randomBytes(32).toString("hex");
  const operator=new pg.Client({connectionString:operatorUrl.toString()});
  let fixture:pg.Client|undefined;
  await operator.connect();
  try{
    await operator.query(`CREATE ROLE ${name} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD '${password}'`);
    await operator.query(`CREATE DATABASE ${name} OWNER ${name}`);
    const fixtureUrl=new URL(operatorUrl);fixtureUrl.pathname=`/${name}`;
    fixture=new pg.Client({connectionString:fixtureUrl.toString()});await fixture.connect();
    // Managed extension objects are provisioned by the platform, not the Auth migration role.
    await fixture.query(`CREATE SCHEMA extensions AUTHORIZATION ${name}; CREATE EXTENSION btree_gist WITH SCHEMA extensions;`);
    await fixture.query(`CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,created_at timestamptz DEFAULT now());
      INSERT INTO auth.users(id,email) VALUES('00000000-0000-0000-0000-000000000001','existing@example.invalid');
      GRANT USAGE ON SCHEMA auth TO ${name}; GRANT SELECT,REFERENCES ON auth.users TO ${name};`);
    const ownerBefore=(await fixture.query("SELECT relowner FROM pg_class WHERE oid='auth.users'::regclass")).rows[0].relowner;
    const migrationUrl=new URL(fixtureUrl);migrationUrl.username=name;migrationUrl.password=password;
    const result=spawnSync(process.execPath,["scripts/db-migrate.mjs"],{encoding:"utf8",timeout:60000,env:{...process.env,MIGRATION_DATABASE_URL:migrationUrl.toString()}});
    expect(result.status,result.stderr).toBe(0);
    expect((await fixture.query("SELECT email FROM auth.users")).rows).toEqual([{email:"existing@example.invalid"}]);
    expect((await fixture.query("SELECT relowner FROM pg_class WHERE oid='auth.users'::regclass")).rows[0].relowner).toBe(ownerBefore);
    expect((await fixture.query("SELECT has_schema_privilege($1,'auth','CREATE') AS can_create",[name])).rows[0].can_create).toBe(false);
    expect((await fixture.query("SELECT n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='btree_gist'")).rows[0].nspname).toBe("extensions");
    expect((await fixture.query("SELECT count(*)::integer AS n FROM migration.applied")).rows[0].n).toBeGreaterThanOrEqual(21);
    expect((await fixture.query("SELECT count(*)::integer AS n FROM app.roles WHERE code='owner'")).rows[0].n).toBe(1);
    expect((await fixture.query("SELECT p.code FROM app.role_permissions rp JOIN app.roles r ON r.id=rp.role_id JOIN app.permissions p ON p.id=rp.permission_id WHERE r.code='owner' AND p.code IN ('staff.manage','catalog.write') ORDER BY p.code")).rows).toEqual([{code:"catalog.write"},{code:"staff.manage"}]);
    expect((await fixture.query("SELECT count(*)::integer AS n FROM app.locales")).rows[0].n).toBe(10);
    expect((await fixture.query("SELECT code FROM app.currencies WHERE enabled_for_charge")).rows).toEqual([{code:"EGP"}]);
    expect((await fixture.query("SELECT booking_enabled,content_approved_at FROM app.agency_settings")).rows).toEqual([{booking_enabled:false,content_approved_at:null}]);
    for(const table of ["services","apartments","guests","price_rules","policy_versions","staff_profiles"]){
      expect((await fixture.query(`SELECT count(*)::integer AS n FROM app.${table}`)).rows[0].n).toBe(0);
    }
    expect((await fixture.query("SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='app' AND c.relkind='r' AND NOT c.relrowsecurity")).rows).toEqual([]);
  }finally{
    await fixture?.end();
    await operator.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await operator.query(`DROP ROLE IF EXISTS ${name}`);
    await operator.end();
  }
},90000);
