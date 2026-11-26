import {afterEach,expect,test,vi} from "vitest";
import {Client} from "pg";
import type {ConnectionOptions} from "node:tls";

afterEach(()=>{vi.unstubAllEnvs();vi.resetModules();});

test("the deployed pg client preserves its trusted CA and hostname verification",async()=>{
  vi.stubEnv("NODE_ENV","production");vi.stubEnv("APP_ENV","production");
  vi.stubEnv("DATABASE_URL","postgresql://tourism_app:synthetic@db.example/app?sslmode=verify-full");
  vi.stubEnv("DATABASE_SSL_CA","synthetic CA configuration");
  const {pool}=await import("../../src/server/db");
  try{
    const client=new Client(pool.options);
    expect(client.ssl).toMatchObject({ca:"synthetic CA configuration",rejectUnauthorized:true});
    expect((client.ssl as unknown as ConnectionOptions).checkServerIdentity).toBeUndefined();
  }finally{await pool.end();}
});

test.each(["sslmode=disable","sslmode=no-verify","ssl=0","sslrootcert=untrusted.crt"])("hosted database refuses conflicting TLS query option %s",async(option)=>{
  vi.stubEnv("NODE_ENV","production");vi.stubEnv("APP_ENV","production");
  vi.stubEnv("DATABASE_URL",`postgresql://tourism_app:synthetic@db.example/app?${option}`);
  vi.stubEnv("DATABASE_SSL_CA","synthetic CA configuration");
  await expect(import("../../src/server/db")).rejects.toThrow("DATABASE_TLS_OPTIONS_CONFLICT");
});

test("hosted databases with public CAs still verify certificates by default",async()=>{
  vi.stubEnv("NODE_ENV","production");vi.stubEnv("APP_ENV","staging");
  vi.stubEnv("DATABASE_URL","postgresql://tourism_app:synthetic@db.example/app");vi.stubEnv("DATABASE_SSL_CA","");
  const {pool}=await import("../../src/server/db");
  try{expect(new Client(pool.options).ssl).toMatchObject({rejectUnauthorized:true});}finally{await pool.end();}
});
