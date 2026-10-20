import {randomUUID} from "node:crypto";
import {AppError,normalizeError} from "./errors";
import {digestSecret} from "@/server/security";
import {query} from "@/server/db";

export async function readJson(request:Request,maxBytes=64*1024):Promise<unknown> {
  if(!request.headers.get("content-type")?.includes("application/json"))throw new AppError("CONTENT_TYPE",400,"JSON is required.");
  try{return JSON.parse(await readRawBody(request,maxBytes));}catch(error){if(error instanceof AppError)throw error;throw new AppError("INVALID_JSON",400);}
}
export async function readRawBody(request:Request,maxBytes=256*1024):Promise<string> {
  if(Number(request.headers.get("content-length")??0)>maxBytes)throw new AppError("BODY_TOO_LARGE",413);
  const reader=request.body?.getReader();
  if(!reader)throw new AppError("INVALID_JSON",400);
  const chunks:Uint8Array[]=[];let size=0;
  for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBytes){await reader.cancel();throw new AppError("BODY_TOO_LARGE",413);}chunks.push(value);}
  return Buffer.concat(chunks).toString("utf8");
}
export function success(data:unknown,status=200,cookies:string[]=[]):Response {
  const headers=new Headers({"Content-Type":"application/json","Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","X-Robots-Tag":"noindex"});
  for(const cookie of cookies)headers.append("Set-Cookie",cookie);
  return new Response(JSON.stringify({data,meta:{requestId:randomUUID(),nextCursor:null}},(_,v)=>typeof v==="bigint"?String(v):v),{status,headers});
}
export function failure(error:unknown):Response {
  const known=normalizeError(error),requestId=randomUUID();
  // Only codes/correlation IDs reach logs. No database errors, payloads or contacts.
  if(known.status>=500)console.error(JSON.stringify({event:"request_failed",code:known.code,requestId}));
  return Response.json({error:{code:known.code,message:known.message,fields:known.fields},meta:{requestId}},{status:known.status,headers:{"Cache-Control":"private, no-store","X-Robots-Tag":"noindex"}});
}
export async function rateLimit(request:Request,operation:string,limit=30,identity?:string) {
  // Deployment proxy owns these headers. Local unknown clients share a conservative bucket.
  const ip=process.env.VERCEL==="1"?request.headers.get("x-vercel-forwarded-for")??"unknown":"local";
  const key=digestSecret(`${operation}:${identity??ip}`);
  const {rows}=await query<{allowed:boolean}>("SELECT * FROM app.consume_rate_limit($1,$2,60,$3)",[key,operation,limit]);
  if(!rows[0]?.allowed)throw new AppError("RATE_LIMITED",429,"Please wait before trying again.");
}
export function idempotencyKey(request:Request) {
  const key=request.headers.get("idempotency-key");
  if(!key||key.length<8||key.length>200)throw new AppError("IDEMPOTENCY_KEY_REQUIRED",400);
  return key;
}
