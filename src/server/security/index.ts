import {createHmac,randomBytes,timingSafeEqual} from "node:crypto";

export function newSecret() { return randomBytes(32).toString("base64url"); }
export function digestSecret(value:string,pepper=process.env.TOKEN_HASH_PEPPER ?? "") {
  if(!pepper) throw new Error("TOKEN_HASH_PEPPER_REQUIRED");
  return createHmac("sha256",pepper).update(value).digest("hex");
}
export function safeEqual(left:string,right:string) {
  const a=Buffer.from(left),b=Buffer.from(right);
  return a.length===b.length && timingSafeEqual(a,b);
}
export function assertOrigin(request:Request,baseUrl:string) {
  const origin=request.headers.get("origin");
  if(!origin || origin!==new URL(baseUrl).origin) throw new Error("ORIGIN_FORBIDDEN");
}
export function redact(value:unknown):unknown {
  if(Array.isArray(value)) return value.map(redact);
  if(value!==null && typeof value==="object") return Object.fromEntries(Object.entries(value).map(([key,v])=>[
    key, /token|secret|password|authorization|cookie|email|phone|payload|screening|signedurl/i.test(key) ? "[REDACTED]" : redact(v)
  ]));
  return value;
}
