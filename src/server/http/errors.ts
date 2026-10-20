import {ZodError} from "zod";
import {MediaError} from "@/modules/photography/validation";
export class AppError extends Error {
  constructor(public code:string, public status:number, message=code, public fields:Record<string,string>={}) { super(message); }
}
export function normalizeError(error:unknown):AppError {
  if(error instanceof AppError) return error;
  if(error instanceof MediaError) return new AppError(error.code,error.status,error.message.toLowerCase().replaceAll("_"," "));
  if(error instanceof ZodError) return new AppError("VALIDATION_ERROR",400,"Please check the highlighted fields.",Object.fromEntries(error.issues.map(i=>[i.path.join("."),i.message])));
  if(error instanceof Error) {
    const code=(error as {code?:string}).code;
    if(code==="23505" || code==="23P01" || code==="40001" || code==="40P01") return new AppError("INVENTORY_CONFLICT",409,"The record changed or inventory is no longer available. Refresh and try again.");
    if(code==="42501" || /^(FORBIDDEN|SCOPE_FORBIDDEN|ORIGIN_FORBIDDEN)/.test(error.message)) return new AppError("FORBIDDEN",403,"This action is not permitted.");
    const known:Record<string,number>={QUOTE_EXPIRED:410,GRANT_EXPIRED:410,NOT_FOUND:404,INVALID_STATE:409,VERSION_CONFLICT:409,INVENTORY_CONFLICT:409,IDEMPOTENCY_CONFLICT:409,INVALID_BINDING:403,PAYMENT_NOT_ELIGIBLE:409,INCOMPATIBLE_PAYMENT_POLICY:422,MINIMUM_STAY:422,INVALID_STAY:422,PAYMENT_POLICY_UNAVAILABLE:422,SELLABLE_UNAVAILABLE:422,CURRENCY_MISMATCH:422,INVALID_PARTICIPANTS:422,POLICY_NOT_ACCEPTED:422,UNAPPROVED_POLICY:422,OVER_REFUND:422};
    const key=error.message.split(/[:\s]/)[0];
    if(known[key]) return new AppError(key,known[key],key.toLowerCase().replaceAll("_"," "));
    if(code==="P0001"&&/^[A-Z][A-Z0-9_]{2,79}$/.test(error.message)){
      const status=/CONFLICT|VERSION|ALREADY|IN_USE|INVALID_STATE|HOLD_EXPIRED|ATTEMPT_TRANSITION/.test(key)?409:/NOT_FOUND|UNAVAILABLE/.test(key)?404:/REQUIRES|UNAPPROVED|REQUIRED/.test(key)?422:422;
      return new AppError(key,status,key.toLowerCase().replaceAll("_"," "));
    }
    if(code?.startsWith("22") || code?.startsWith("23")) return new AppError("VALIDATION_ERROR",422,"The submitted values do not satisfy the booking rules.");
    if(code==="ECONNREFUSED" || /DATABASE_URL_REQUIRED/.test(error.message)) return new AppError("DEPENDENCY_UNAVAILABLE",503,"The reservation service is temporarily unavailable.");
  }
  return new AppError("INTERNAL_ERROR",500,"The request could not be completed.");
}
