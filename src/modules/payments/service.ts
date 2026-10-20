import {z} from "zod";
import {createHash} from "node:crypto";
import {query,withTransaction} from "@/server/db";
import {AppError} from "@/server/http/errors";
import type {GuestActor} from "@/server/auth";
import {createIntention,paymobConfiguration,inquireOrder,paymentMethodIds} from "@/integrations/paymob/client";
import {transactionSchema,verifyTransaction,correlationOfTransaction,eventFingerprint,stateOfTransaction} from "@/integrations/paymob/verification";
export const attemptInput=z.object({obligationId:z.guid(),method:z.enum(["card","wallet"]),billing:z.object({firstName:z.string().trim().min(1).max(80),lastName:z.string().trim().min(1).max(80),email:z.email(),phone:z.string().regex(/^\+[1-9]\d{6,14}$/)}).strict()}).strict();
export async function startPayment(actor:GuestActor,input:unknown,key:string) {
  if(!actor.scope.includes("payment:create"))throw new AppError("FORBIDDEN",403);
  const body=attemptInput.parse(input),config=paymobConfiguration();
  paymentMethodIds(body.method);
  const fingerprint=createHash("sha256").update(JSON.stringify(body)).digest("hex");
  const {rows}=await query("SELECT app.create_payment_attempt_bound($1,$2,$3,'paymob',$4,$5) AS attempt",[actor.bookingId,body.obligationId,key,config.environment,fingerprint]);
  const attempt=rows[0].attempt;
  if(["succeeded","failed"].includes(attempt.status))throw new AppError("PAYMENT_ALREADY_COMPLETE",409);
  if(attempt.checkout_expires_at&&new Date(attempt.checkout_expires_at)<=new Date())throw new AppError("PAYMENT_HOLD_EXPIRED",409);
  const current=await query("SELECT status,payment_deadline FROM app.bookings WHERE id=$1",[actor.bookingId]);
  if(!["approved_pending_payment","confirmed"].includes(current.rows[0]?.status))throw new AppError("PAYMENT_NOT_ELIGIBLE",409);
  const saved=await query("SELECT provider_ref,checkout_url FROM app.payment_checkout_sessions WHERE attempt_id=$1",[attempt.id]);
  if(saved.rows[0]?.checkout_url)return {attemptId:attempt.id,checkoutUrl:saved.rows[0].checkout_url};
  // Claim the only external creation request. A crash/timeout leaves an unknown attempt,
  // requiring reconciliation; retries never create a second provider intention.
  const claim=await query("SELECT app.claim_payment_creation($1) AS claimed",[attempt.id]);
  if(!claim.rows[0].claimed)throw new AppError("PAYMENT_OUTCOME_PENDING",409,"The payment request is being reconciled. Do not start another payment.");
  const booking=await query("SELECT reference FROM app.bookings WHERE id=$1",[actor.bookingId]);
  try{
    const intention=await createIntention({id:attempt.id,amountMinor:String(attempt.expected_amount),currency:attempt.currency,reference:booking.rows[0].reference,...body.billing,method:body.method});
    await query("SELECT app.finish_payment_creation($1,$2,$3,$4)",[attempt.id,intention.orderId,intention.checkoutUrl,"pending"]);
    return {attemptId:attempt.id,checkoutUrl:intention.checkoutUrl};
  }catch{
    await query("SELECT app.finish_payment_creation($1,NULL,NULL,'unknown')",[attempt.id]);
    throw new AppError("PAYMENT_OUTCOME_PENDING",503,"The provider response could not be verified. Staff will reconcile this attempt.");
  }
}
async function applyVerifiedTransaction(input:unknown) {
  const transaction=transactionSchema.parse(input),config=paymobConfiguration();
  // Only the signed provider order ID selects an attempt. merchant_order_id/extras
  // are NOT signed by the standard HMAC and cannot authorize correlation.
  const {rows}=await query("SELECT a.*,s.provider_ref FROM app.payment_attempts a JOIN app.payment_checkout_sessions s ON s.attempt_id=a.id WHERE s.provider_ref=$1 AND a.provider='paymob' AND a.environment=$2",[String(transaction.order.id),config.environment]);
  const attempt=rows[0];if(!attempt)throw new AppError("UNKNOWN_PAYMENT_ATTEMPT",409);
  if(!correlationOfTransaction(transaction,{account:process.env.PAYMOB_ACCOUNT_ID!,integrationIds:config.integrations,currency:attempt.currency,amountMinor:String(attempt.expected_amount),orderId:attempt.provider_ref}))throw new AppError("PAYMENT_CORRELATION_MISMATCH",422);
  const kind=stateOfTransaction(transaction);
  if(kind==="reconciliation_required"){
    await query("SELECT app.flag_payment_reconciliation($1,$2)",[attempt.id,eventFingerprint(transaction)]);
    return {reconciliationRequired:true};
  }
  const event={attemptId:attempt.id,provider:"paymob",account:process.env.PAYMOB_ACCOUNT_ID,environment:config.environment,eventKey:eventFingerprint(transaction),transactionId:String(transaction.id),kind,amountMinor:String(transaction.amount_cents),currency:transaction.currency};
  return withTransaction({type:"system"},async tx=>(await tx.query("SELECT app.apply_payment_event($1) AS result",[JSON.stringify(event)])).rows[0].result);
}
export async function paymobWebhook(input:unknown,signature:string) {
  const body=z.object({type:z.literal("TRANSACTION"),obj:z.unknown()}).passthrough().parse(input);
  if(!verifyTransaction(body.obj,signature,process.env.PAYMOB_HMAC_SECRET??""))throw new AppError("INVALID_SIGNATURE",401);
  return applyVerifiedTransaction(body.obj);
}
export async function reconcileAttempt(attemptId:string) {
  const {rows}=await query("SELECT provider_ref FROM app.payment_checkout_sessions WHERE attempt_id=$1",[attemptId]);
  if(!rows[0]?.provider_ref)throw new AppError("PROVIDER_ORDER_UNKNOWN",409,"Provider order creation needs merchant reconciliation; another charge is blocked.");
  const order=await inquireOrder(rows[0].provider_ref);
  if(String(order.id)!==rows[0].provider_ref)throw new AppError("PAYMENT_CORRELATION_MISMATCH",422);
  const results=[];for(const transaction of order.transactions)results.push(await applyVerifiedTransaction(transaction));
  return results;
}
