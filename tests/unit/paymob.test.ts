import {createHmac} from "node:crypto";
import {describe,it,expect} from "vitest";
import {canonicalTransaction,verifyTransaction,stateOfTransaction,correlationOfTransaction} from "@/integrations/paymob/verification";
const transaction={amount_cents:100,created_at:"2020-03-25T18:39:44.719228",currency:"EGP",error_occured:false,has_parent_transaction:false,id:2556706,integration_id:6741,is_3d_secure:true,is_auth:false,is_capture:false,is_refunded:false,is_standalone_payment:true,is_voided:false,order:{id:4778239,merchant_order_id:"e6dcc86b-0d21-4ec2-9c96-d2bdd1cd9400"},owner:4705,pending:false,source_data:{pan:"2346",sub_type:"MasterCard",type:"card"},success:true};
describe("Paymob authenticated transaction processing",()=>{
  it("matches the exact upstream ordered field string",()=>{
    expect(canonicalTransaction(transaction)).toBe("1002020-03-25T18:39:44.719228EGPfalsefalse25567066741truefalsefalsefalsetruefalse47782394705false2346MasterCardcardtrue");
  });
  it("accepts only constant-length authentic signatures",()=>{
    const hmac=createHmac("sha512","synthetic-test-secret").update(canonicalTransaction(transaction)).digest("hex");
    expect(verifyTransaction(transaction,hmac,"synthetic-test-secret")).toBe(true);
    expect(verifyTransaction({...transaction,amount_cents:101},hmac,"synthetic-test-secret")).toBe(false);
    expect(verifyTransaction(transaction,"a","synthetic-test-secret")).toBe(false);
  });
  it("rejects ambiguous absent signed fields and unsafe money",()=>{
    expect(()=>canonicalTransaction({...transaction,owner:undefined})).toThrow();
    expect(()=>canonicalTransaction({...transaction,amount_cents:Number.MAX_SAFE_INTEGER+1})).toThrow();
  });
  it("does not confuse pending, authorization, failure, capture or financial reversal",()=>{
    expect(stateOfTransaction(transaction)).toBe("succeeded");
    expect(stateOfTransaction({...transaction,pending:true})).toBe("pending");
    expect(stateOfTransaction({...transaction,is_auth:true,is_capture:false})).toBe("pending");
    expect(stateOfTransaction({...transaction,success:false})).toBe("failed");
    expect(stateOfTransaction({...transaction,is_refunded:true})).toBe("reconciliation_required");
    expect(stateOfTransaction({...transaction,is_voided:true})).toBe("reconciliation_required");
  });
  it("rejects wrong merchant, method, currency and stored order correlation",()=>{
    const expected={account:"4705",integrationIds:["6741"],currency:"EGP",amountMinor:"100",orderId:"4778239"};
    expect(correlationOfTransaction(transaction,expected)).toBe(true);
    for(const change of [{account:"123"},{integrationIds:["1"]},{currency:"EUR"},{amountMinor:"500"},{orderId:"1"}])
      expect(correlationOfTransaction(transaction,{...expected,...change})).toBe(false);
  });
});
