import {test,expect} from "vitest";
import {verifyRefundInquiry} from "@/integrations/paymob/refunds";
const expected={providerRefundId:"202",originalTransactionId:"101",orderId:"303",account:"404",environment:"sandbox",integrationIds:["505"],amountMinor:"1000",currency:"EGP",notBefore:"2026-10-20T10:00:00Z"};
const response={id:202,parent_transaction:101,has_parent_transaction:true,is_refund:true,success:true,pending:false,error_occured:false,is_live:false,owner:404,integration_id:505,amount_cents:1000,currency:"EGP",order:{id:303},created_at:"2026-10-20T10:00:01Z"};
test("online_refund_requires_authenticated_exact_parent_account_amount_and_final_state",()=>{
  expect(verifyRefundInquiry(response,expected)).toBe(true);
  for(const changed of [{parent_transaction:999},{amount_cents:1001},{currency:"EUR"},{owner:999},{is_live:true},{pending:true},{is_refund:false},{success:false},{id:101},{created_at:"2026-10-19T10:00:00Z"},{integration_id:999}]){
    expect(verifyRefundInquiry({...response,...changed},expected),JSON.stringify(changed)).toBe(false);
  }
});
test("refund_summary_flag_is_not_proof_of_specific_refund",()=>{
  expect(verifyRefundInquiry({...response,id:101,is_refund:undefined,is_refunded:true,parent_transaction:null},expected)).toBe(false);
});
