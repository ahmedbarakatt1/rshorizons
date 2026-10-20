import {createHmac,createHash,timingSafeEqual} from "node:crypto";
import {z} from "zod";

const scalarId=z.union([z.string().regex(/^\d+$/),z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)]);
export const transactionSchema=z.object({
  amount_cents:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),created_at:z.string().min(1),
  currency:z.string().regex(/^[A-Z]{3}$/),error_occured:z.boolean(),has_parent_transaction:z.boolean(),
  id:scalarId,integration_id:scalarId,is_3d_secure:z.boolean(),is_auth:z.boolean(),is_capture:z.boolean(),
  is_refunded:z.boolean(),is_standalone_payment:z.boolean(),is_voided:z.boolean(),
  order:z.object({id:scalarId,merchant_order_id:z.string().optional()}).passthrough(),owner:scalarId,
  pending:z.boolean(),source_data:z.object({pan:z.string(),sub_type:z.string(),type:z.string()}),success:z.boolean()
}).passthrough();
export type PaymobTransaction=z.infer<typeof transactionSchema>;
export function canonicalTransaction(input:unknown) {
  const t=transactionSchema.parse(input);
  return [t.amount_cents,t.created_at,t.currency,t.error_occured,t.has_parent_transaction,t.id,t.integration_id,t.is_3d_secure,t.is_auth,t.is_capture,t.is_refunded,t.is_standalone_payment,t.is_voided,t.order.id,t.owner,t.pending,t.source_data.pan,t.source_data.sub_type,t.source_data.type,t.success].join("");
}
export function verifyTransaction(input:unknown,signature:string,secret:string) {
  if(!secret||!/^[0-9a-f]{128}$/i.test(signature))return false;
  try {
    const expected=createHmac("sha512",secret).update(canonicalTransaction(input)).digest();
    return timingSafeEqual(expected,Buffer.from(signature,"hex"));
  }catch{return false;}
}
export function eventFingerprint(input:unknown) {return createHash("sha256").update(canonicalTransaction(input)).digest("hex");}
export function stateOfTransaction(input:unknown) {
  const t=transactionSchema.parse(input);
  // The signed summary flag does not identify a partial-refund amount or a unique refund.
  // Reconcile those events from the authenticated provider API; never debit a guessed amount.
  if(t.is_refunded||t.is_voided)return "reconciliation_required" as const;
  if(t.pending||t.is_auth&&!t.is_capture)return "pending" as const;
  return t.success&&!t.error_occured?"succeeded" as const:"failed" as const;
}
export function correlationOfTransaction(input:unknown,expected:{account:string;integrationIds:string[];currency:string;amountMinor:string;orderId:string}) {
  const t=transactionSchema.parse(input);
  return String(t.owner)===expected.account&&expected.integrationIds.includes(String(t.integration_id))&&t.currency===expected.currency&&String(t.amount_cents)===expected.amountMinor&&String(t.order.id)===expected.orderId;
}
