import {z} from "zod";
import {paymobConfiguration} from "./client";
import {AppError} from "@/server/http/errors";
const id=z.union([z.string().regex(/^\d+$/),z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)]);
const inquiry=z.object({id,parent_transaction:id,has_parent_transaction:z.literal(true),is_refund:z.literal(true),success:z.literal(true),pending:z.literal(false),error_occured:z.literal(false),is_live:z.boolean(),owner:id,integration_id:id,amount_cents:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),currency:z.string(),order:z.object({id}),created_at:z.string()});
export function verifyRefundInquiry(input:unknown,expected:{providerRefundId:string;originalTransactionId:string;orderId:string;account:string;environment:string;integrationIds:string[];amountMinor:string;currency:string;notBefore:string}){
  const result=inquiry.safeParse(input);if(!result.success)return false;
  const t=result.data,created=Date.parse(t.created_at);
  // A summary is not a refund: this must be a distinct, final, parent-linked
  // transaction returned by the authenticated provider inquiry API.
  return String(t.id)===expected.providerRefundId&&String(t.id)!==expected.originalTransactionId
    &&String(t.parent_transaction)===expected.originalTransactionId&&String(t.order.id)===expected.orderId
    &&String(t.owner)===expected.account&&expected.integrationIds.includes(String(t.integration_id))
    &&t.is_live===(expected.environment==="production")&&String(t.amount_cents)===expected.amountMinor
    &&t.currency===expected.currency&&Number.isFinite(created)&&created>=Date.parse(expected.notBefore)-5000;
}
export async function requestProviderRefund(transactionId:string,amountMinor:string){
  const config=paymobConfiguration(),amount=Number(amountMinor);
  if(!/^\d+$/.test(transactionId)||!Number.isSafeInteger(Number(transactionId))||!Number.isSafeInteger(amount)||amount<=0)throw new AppError("INVALID_REFUND_INPUT",422);
  // Deliberately one network attempt. An ambiguous failure requires inquiry;
  // merchant-side refund APIs do not promise idempotent blind retries.
  const response=await fetch(`${config.base}/api/acceptance/void_refund/refund`,{method:"POST",headers:{Authorization:`Token ${config.key}`,"Content-Type":"application/json"},body:JSON.stringify({transaction_id:Number(transactionId),amount_cents:amount}),redirect:"error",cache:"no-store",signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw new AppError("REFUND_PROVIDER_OUTCOME_UNKNOWN",503);
  return String(z.object({id}).parse(await response.json()).id);
}
export async function inquireProviderTransaction(transactionId:string){
  const config=paymobConfiguration();
  if(!/^\d+$/.test(transactionId)||!process.env.PAYMOB_API_KEY)throw new AppError("RECONCILIATION_UNAVAILABLE",503);
  const auth=await fetch(`${config.base}/api/auth/tokens`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({api_key:process.env.PAYMOB_API_KEY}),redirect:"error",cache:"no-store",signal:AbortSignal.timeout(15000)});
  if(!auth.ok)throw new AppError("PROVIDER_AUTH_UNAVAILABLE",502);
  const {token}=z.object({token:z.string().min(1)}).parse(await auth.json());
  const response=await fetch(`${config.base}/api/acceptance/transactions/${transactionId}`,{headers:{Authorization:`Bearer ${token}`},redirect:"error",cache:"no-store",signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new AppError("PROVIDER_INQUIRY_UNAVAILABLE",502);
  return response.json() as Promise<unknown>;
}
