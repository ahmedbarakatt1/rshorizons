import {query,withTransaction} from "@/server/db";
import type {StaffActor} from "@/server/auth";
import {AppError} from "@/server/http/errors";
import {paymobConfiguration} from "@/integrations/paymob/client";
import {requestProviderRefund,inquireProviderTransaction,verifyRefundInquiry} from "@/integrations/paymob/refunds";

export async function reconcileRefund(refundId:string,providerRefundId:string,actor:StaffActor){
  const config=paymobConfiguration();
  const {rows}=await query(`SELECT r.booking_id,r.amount::text,r.currency,a.id,a.external_ref,a.created_at,t.transaction_id,t.account,t.environment,s.provider_ref AS order_id
    FROM app.refund_requests r JOIN app.refund_attempts a ON a.refund_request_id=r.id
    JOIN app.payment_transactions t ON t.id=r.original_transaction_id JOIN app.payment_checkout_sessions s ON s.attempt_id=t.attempt_id
    WHERE r.id=$1 AND a.route=t.provider||':'||t.account||':'||t.environment ORDER BY a.created_at DESC LIMIT 1`,[refundId]);
  const row=rows[0];if(!row)throw new AppError("NOT_FOUND",404);
  await query("SELECT app.assert_staff($1,'finance.reconcile',$2)",[actor.id,row.booking_id]);
  if(row.external_ref&&row.external_ref!==providerRefundId)throw new AppError("REFUND_CORRELATION_MISMATCH",422);
  if(row.environment!==config.environment||row.account!==process.env.PAYMOB_ACCOUNT_ID)throw new AppError("PAYMENT_CONFIGURATION_ERROR",503);
  const remote=await inquireProviderTransaction(providerRefundId);
  if(!verifyRefundInquiry(remote,{providerRefundId,originalTransactionId:row.transaction_id,orderId:row.order_id,account:row.account,environment:row.environment,integrationIds:config.integrations,amountMinor:row.amount,currency:row.currency,notBefore:new Date(row.created_at).toISOString()}))throw new AppError("REFUND_NOT_VERIFIED",409,"The provider has not verified this exact refund. No ledger entry was added.");
  return withTransaction(actor,async tx=>(await tx.query("SELECT app.complete_online_refund($1,$2) AS result",[row.id,providerRefundId])).rows[0].result);
}
export async function executeRefund(refundId:string,expectedVersion:number,actor:StaffActor){
  const config=paymobConfiguration();
  if(process.env.PAYMOB_REFUNDS_ENABLED!=="true")throw new AppError("REFUNDS_NOT_ENABLED",503,"Enable refunds only after the agency's merchant refund workflow has been verified.");
  const source=(await query("SELECT t.account,t.environment,r.booking_id FROM app.refund_requests r JOIN app.payment_transactions t ON t.id=r.original_transaction_id WHERE r.id=$1",[refundId])).rows[0];
  if(!source)throw new AppError("ONLINE_REFUND_REQUIRED",422);
  await query("SELECT app.assert_staff($1,'refunds.approve',$2)",[actor.id,source.booking_id]);
  if(source.account!==process.env.PAYMOB_ACCOUNT_ID||source.environment!==config.environment)throw new AppError("PAYMENT_CONFIGURATION_ERROR",503);
  const claim=await withTransaction(actor,async tx=>(await tx.query("SELECT app.claim_online_refund($1,$2,$3) AS result",[refundId,expectedVersion,actor.id])).rows[0].result);
  let providerRef:string|null=null;
  try{
    providerRef=await requestProviderRefund(claim.transaction_id,String(claim.amount));
    await query("SELECT app.save_online_refund_reference($1,$2)",[claim.id,providerRef]);
    return await reconcileRefund(refundId,providerRef,actor);
  }catch{
    await query("SELECT app.save_online_refund_reference($1,$2)",[claim.id,providerRef]);
    throw new AppError("REFUND_OUTCOME_PENDING",409,"The refund outcome requires authenticated reconciliation. This request will not be sent again.");
  }
}
