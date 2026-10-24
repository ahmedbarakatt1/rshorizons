import {openWaOrigin,openWaSession} from "@/integrations/messaging/openwa-config";
export type EnvironmentTarget = "development" | "test" | "staging" | "production";
export type ValidatedEnvironment = {
  target: EnvironmentTarget;
  demo: boolean;
  bookingEnabled: boolean;
  baseUrl: string;
};

export function readEnvironment(
  target: EnvironmentTarget,
  source: Record<string, string | undefined> = process.env
): ValidatedEnvironment {
  const problems: string[] = [];
  const serverSecretNames = ["DATABASE_URL","SUPABASE_SECRET_KEY","PAYMOB_SECRET_KEY","PAYMOB_API_KEY","PAYMOB_HMAC_SECRET","WHATSAPP_TOKEN","META_APP_SECRET","OPENWA_API_KEY","OPENWA_WEBHOOK_SECRET","EMAIL_API_KEY","CRON_SECRET","TOKEN_HASH_PEPPER","VIDEO_API_TOKEN","VIDEO_SIGNING_PRIVATE_KEY","VIDEO_WEBHOOK_SECRET","SENTRY_AUTH_TOKEN"];
  for(const [name,value] of Object.entries(source)) {
    if(!name.startsWith("NEXT_PUBLIC_") || !value) continue;
    if(/SECRET|PASSWORD|PRIVATE|SERVICE_ROLE|DATABASE|TOKEN|PEPPER/i.test(name) ||
      serverSecretNames.some(secret=>source[secret] && value.includes(source[secret]!)) ||
      value.startsWith("sb_secret_")) problems.push(`Forbidden public credential: ${name}`);
  }
  const demo=source.DEMO_MODE === "true" || (source.DEMO_MODE===undefined && (target==="development"||target==="test"));
  const bookingEnabled=source.BOOKING_ENABLED==="true";
  const baseUrl=source.APP_BASE_URL || "http://127.0.0.1:3000";
  if(target==="production") {
    if(source.APP_ENV!=="production") problems.push("APP_ENV must be production");
    if(source.DEMO_MODE!=="false") problems.push("DEMO_MODE must be false");
    if(source.PAYMOB_MODE!=="live") problems.push("PAYMOB_MODE must be live");
    if(!baseUrl.startsWith("https://")) problems.push("APP_BASE_URL requires HTTPS");
    for(const name of ["AGENCY_IDENTITY_APPROVED","BUSINESS_CONTENT_APPROVED","POLICIES_APPROVED","TRANSLATIONS_APPROVED","RETENTION_POLICY_APPROVED"])
      if(source[name]!=="true") problems.push(`${name} requires recorded owner approval`);
    const required=[
      "APP_BASE_URL","DATABASE_URL","NEXT_PUBLIC_SUPABASE_URL","NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY","SUPABASE_SECRET_KEY",
      "PAYMOB_API_BASE_URL","PAYMOB_SECRET_KEY","PAYMOB_HMAC_SECRET","PAYMOB_PUBLIC_KEY","PAYMOB_ACCOUNT_ID","PAYMOB_INTEGRATION_IDS",
      "EMAIL_PROVIDER","EMAIL_API_KEY","EMAIL_FROM","EMAIL_WEBHOOK_SECRET","CRON_SECRET","TOKEN_HASH_PEPPER",
      "SENSITIVE_DATA_KEY_REFERENCE","VIDEO_PROVIDER","VIDEO_API_TOKEN","VIDEO_WEBHOOK_SECRET","MONITORING_ALERT_URL"
    ];
    required.push("PAYMOB_API_KEY","VIDEO_API_TOKEN_ID","VIDEO_ENVIRONMENT_ID","VIDEO_SIGNING_KEY_ID","VIDEO_SIGNING_PRIVATE_KEY","RESEND_ACCOUNT_ID","STAFF_NOTIFICATION_EMAIL","STAFF_NOTIFICATION_LOCALE");
    for(const name of required) if(!source[name]?.trim()) problems.push(`${name} is required`);
    for(const name of ["CRON_SECRET","TOKEN_HASH_PEPPER"]) if((source[name]?.length??0)<32) problems.push(`${name} requires at least 32 characters`);
    for(const name of ["EMAIL_PROVIDER","VIDEO_PROVIDER"]) if(/^(local|demo|fake|mock)$/i.test(source[name]??"")) problems.push(`${name} cannot use a local adapter`);
    for(const name of serverSecretNames) if(/^(password|changeme|secret|demo|test|admin)$/i.test(source[name]??"")) problems.push(`${name} has a forbidden default`);
    try {
      const url=new URL(source.DATABASE_URL??"");
      if(["postgres","supabase_admin"].includes(decodeURIComponent(url.username))) problems.push("DATABASE_URL requires a restricted runtime role");
      if(url.hostname==="localhost" || url.hostname==="127.0.0.1") problems.push("DATABASE_URL cannot use a local database in production");
    } catch { problems.push("DATABASE_URL is invalid"); }
    if(source.DATABASE_URL===source.MIGRATION_DATABASE_URL) problems.push("Runtime and migration credentials must differ");
    if(source.STORAGE_PROVIDER!=="supabase")problems.push("STORAGE_PROVIDER must be supabase");
    if(source.EMAIL_PROVIDER!=="resend")problems.push("EMAIL_PROVIDER must be resend");
    if(source.VIDEO_PROVIDER!=="mux")problems.push("VIDEO_PROVIDER must be mux");
    if(source.MESSAGING_ACCOUNT_VERIFIED!=="true")problems.push("MESSAGING_ACCOUNT_VERIFIED requires provider verification");
    if(source.PAYMOB_REFUNDS_ENABLED!=="true")problems.push("PAYMOB_REFUNDS_ENABLED requires merchant refund verification");
    if(!source.PAYMOB_CARD_INTEGRATION_IDS&&!source.PAYMOB_WALLET_INTEGRATION_IDS)problems.push("At least one approved payment method integration is required");
  }
  if(target==="staging"){
    if(source.APP_ENV!=="staging")problems.push("APP_ENV must be staging");
    if(source.PAYMOB_MODE!=="sandbox")problems.push("Staging PAYMOB_MODE must be sandbox");
    if(source.STAGING_ISOLATION_CONFIRMED!=="true")problems.push("STAGING_ISOLATION_CONFIRMED requires distinct staging accounts, storage and database");
    if(!source.MESSAGING_SANDBOX_ALLOWLIST?.trim())problems.push("MESSAGING_SANDBOX_ALLOWLIST is required for staging");
    for(const name of ["DATABASE_URL","NEXT_PUBLIC_SUPABASE_URL","NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY","SUPABASE_SECRET_KEY"])
      if(!source[name]?.trim())problems.push(`${name} is required`);
    for(const name of ["CRON_SECRET","TOKEN_HASH_PEPPER"])if((source[name]?.length??0)<32)problems.push(`${name} requires at least 32 characters`);
    if(source.STORAGE_PROVIDER!=="supabase")problems.push("Staging STORAGE_PROVIDER must be supabase");
    if(!baseUrl.startsWith("https://"))problems.push("APP_BASE_URL requires HTTPS");
    if(source.DATABASE_URL===source.MIGRATION_DATABASE_URL)problems.push("Runtime and migration credentials must differ");
  }
  if(target==="staging"||target==="production"){
    const provider=source.WHATSAPP_PROVIDER;
    if(!["openwa","meta"].includes(provider??""))problems.push("WHATSAPP_PROVIDER must be openwa or meta");
    const required=provider==="openwa"?["OPENWA_BASE_URL","OPENWA_API_KEY","OPENWA_SESSION_ID","OPENWA_WEBHOOK_SECRET"]:provider==="meta"?["WHATSAPP_TOKEN","WHATSAPP_PHONE_NUMBER_ID","META_APP_SECRET","WHATSAPP_VERIFY_TOKEN","META_GRAPH_API_VERSION","WHATSAPP_BUSINESS_ACCOUNT_ID"]:[];
    for(const name of required)if(!source[name]?.trim())problems.push(`${name} is required`);
    if(provider==="openwa"){
      try{openWaOrigin(source);}catch{problems.push("OPENWA_BASE_URL must be an HTTPS gateway origin without credentials, path or query");}
      try{openWaSession(source);}catch{problems.push("OPENWA_SESSION_ID must contain 1–100 letters, numbers, hyphens or underscores");}
      if((source.OPENWA_WEBHOOK_SECRET?.length??0)<32)problems.push("OPENWA_WEBHOOK_SECRET requires at least 32 characters");
    }
    const retention=Number(source.MEDIA_RETENTION_DAYS);
    if(!Number.isInteger(retention)||retention<1||retention>3650)problems.push("MEDIA_RETENTION_DAYS requires an approved integer between 1 and 3650");
  }
  if(problems.length) throw new Error(`Configuration rejected:\n${[...new Set(problems)].join("\n")}`);
  return {
    target, demo, bookingEnabled,baseUrl
  };
}
