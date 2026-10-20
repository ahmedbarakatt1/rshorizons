import {describe, expect, it} from "vitest";
import {readEnvironment} from "../../src/server/env";

const complete: Record<string,string> = {
  APP_ENV:"production", APP_BASE_URL:"https://tourism.example",
  BOOKING_ENABLED:"true", DEMO_MODE:"false",
  AGENCY_IDENTITY_APPROVED:"true", BUSINESS_CONTENT_APPROVED:"true",
  POLICIES_APPROVED:"true", TRANSLATIONS_APPROVED:"true",
  DATABASE_URL:"postgresql://tourism_app:synthetic@db.example:5432/app",
  NEXT_PUBLIC_SUPABASE_URL:"https://project.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:"sb_publishable_example",
  SUPABASE_SECRET_KEY:"synthetic-secret-for-validation",
  PAYMOB_MODE:"live", PAYMOB_API_BASE_URL:"https://accept.paymob.com",
  PAYMOB_SECRET_KEY:"synthetic-paymob", PAYMOB_HMAC_SECRET:"synthetic-hmac",
  PAYMOB_PUBLIC_KEY:"synthetic-public", PAYMOB_ACCOUNT_ID:"synthetic-account", PAYMOB_INTEGRATION_IDS:"1",
  WHATSAPP_TOKEN:"synthetic-meta", WHATSAPP_PHONE_NUMBER_ID:"synthetic-number",
  META_APP_SECRET:"synthetic-meta-secret", WHATSAPP_VERIFY_TOKEN:"synthetic-verification",
  META_GRAPH_API_VERSION:"v24.0", EMAIL_PROVIDER:"resend", EMAIL_API_KEY:"synthetic-email",
  EMAIL_FROM:"agency@example.com", EMAIL_WEBHOOK_SECRET:"synthetic-email-signature",
  CRON_SECRET:"a".repeat(40), TOKEN_HASH_PEPPER:"b".repeat(40),
  SENSITIVE_DATA_KEY_REFERENCE:"secret-manager://tourism/screening/v1",
  VIDEO_PROVIDER:"mux", VIDEO_API_TOKEN:"synthetic-video", VIDEO_WEBHOOK_SECRET:"synthetic-video-signature",
  MONITORING_ALERT_URL:"https://monitoring.example/alert",
  PAYMOB_API_KEY:"synthetic-inquiry",PAYMOB_CARD_INTEGRATION_IDS:"1",PAYMOB_REFUNDS_ENABLED:"true",STORAGE_PROVIDER:"supabase",
  VIDEO_API_TOKEN_ID:"synthetic-video-id",VIDEO_ENVIRONMENT_ID:"synthetic-video-environment",VIDEO_SIGNING_KEY_ID:"synthetic-signing",VIDEO_SIGNING_PRIVATE_KEY:"synthetic-private",
  RESEND_ACCOUNT_ID:"synthetic-resend",WHATSAPP_BUSINESS_ACCOUNT_ID:"synthetic-whatsapp",
  STAFF_NOTIFICATION_EMAIL:"operator@example.invalid",STAFF_NOTIFICATION_LOCALE:"en",MESSAGING_ACCOUNT_VERIFIED:"true",
  MEDIA_RETENTION_DAYS:"90",RETENTION_POLICY_APPROVED:"true"
};

describe("deployment environment", () => {
  it("production_no_demo_secrets", () => {
    expect(()=>readEnvironment("production",{...complete,DEMO_MODE:"true"})).toThrow(/DEMO_MODE/);
    expect(()=>readEnvironment("production",{...complete,PAYMOB_MODE:"fake"})).toThrow(/PAYMOB_MODE/);
  });
  it("production rejects missing secrets before booking intake", () => {
    expect(()=>readEnvironment("production",{...complete,CRON_SECRET:""})).toThrow(/CRON_SECRET/);
  });
  it("production requires business and translation approval", () => {
    expect(()=>readEnvironment("production",{...complete,POLICIES_APPROVED:"false"})).toThrow(/POLICIES_APPROVED/);
    expect(()=>readEnvironment("production",{...complete,TRANSLATIONS_APPROVED:"false"})).toThrow(/TRANSLATIONS_APPROVED/);
  });
  it("public variables cannot contain server credentials", () => {
    expect(()=>readEnvironment("development",{NEXT_PUBLIC_SUPABASE_SECRET_KEY:"bad"})).toThrow(/public/i);
    expect(()=>readEnvironment("production",{...complete,NEXT_PUBLIC_API_URL:complete.PAYMOB_SECRET_KEY})).toThrow(/public/i);
  });
  it("runtime cannot use migration credentials or a privileged database role", () => {
    expect(()=>readEnvironment("production",{...complete,MIGRATION_DATABASE_URL:complete.DATABASE_URL})).toThrow(/migration/i);
    expect(()=>readEnvironment("production",{...complete,DATABASE_URL:"postgresql://postgres:synthetic@db.example/app"})).toThrow(/role/i);
  });
  it("production requires TLS public URLs and strong token keys", () => {
    expect(()=>readEnvironment("production",{...complete,APP_BASE_URL:"http://tourism.example"})).toThrow(/HTTPS/);
    expect(()=>readEnvironment("production",{...complete,TOKEN_HASH_PEPPER:"short"})).toThrow(/TOKEN_HASH_PEPPER/);
  });
  it("valid isolated configuration returns server flags", () => {
    expect(readEnvironment("production", complete)).toMatchObject({target:"production",demo:false,bookingEnabled:true});
    expect(readEnvironment("development",{})).toMatchObject({target:"development",demo:true,bookingEnabled:false});
  });
  it("production_storage_and_private_video_fail_closed",()=>{
    expect(()=>readEnvironment("production",{...complete,STORAGE_PROVIDER:"local"})).toThrow(/STORAGE_PROVIDER/);
    expect(()=>readEnvironment("production",{...complete,VIDEO_SIGNING_PRIVATE_KEY:""})).toThrow(/VIDEO_SIGNING_PRIVATE_KEY/);
    expect(()=>readEnvironment("production",{...complete,MEDIA_RETENTION_DAYS:""})).toThrow(/MEDIA_RETENTION_DAYS/);
    expect(()=>readEnvironment("production",{...complete,RETENTION_POLICY_APPROVED:"false"})).toThrow(/RETENTION_POLICY_APPROVED/);
  });
  it("staging_rejects_live_payments_and_unrestricted_messaging",()=>{
    const stage={...complete,APP_ENV:"staging",STAGING_ISOLATION_CONFIRMED:"true",PAYMOB_MODE:"sandbox",MESSAGING_SANDBOX_ALLOWLIST:"test@example.invalid"};
    expect(readEnvironment("staging",stage).target).toBe("staging");
    expect(()=>readEnvironment("staging",{...stage,PAYMOB_MODE:"live"})).toThrow(/sandbox/);
    expect(()=>readEnvironment("staging",{...stage,MESSAGING_SANDBOX_ALLOWLIST:""})).toThrow(/ALLOWLIST/);
    expect(()=>readEnvironment("staging",{...stage,STAGING_ISOLATION_CONFIRMED:""})).toThrow(/ISOLATION/);
  });
});
