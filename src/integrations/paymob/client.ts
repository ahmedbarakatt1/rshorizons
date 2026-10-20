import {z} from "zod";
import {AppError} from "@/server/http/errors";
const allowedOrigins=new Set(["https://accept.paymob.com","https://oman.paymob.com","https://ksa.paymob.com","https://uae.paymob.com"]);
export function paymobConfiguration() {
  const base=process.env.PAYMOB_API_BASE_URL?.replace(/\/$/,"");
  const key=process.env.PAYMOB_SECRET_KEY,publicKey=process.env.PAYMOB_PUBLIC_KEY;
  const integrations=process.env.PAYMOB_INTEGRATION_IDS?.split(",").map(v=>v.trim()).filter(Boolean)??[];
  if(!base||!allowedOrigins.has(base)||!key||!publicKey||!integrations.length||!process.env.PAYMOB_HMAC_SECRET||!process.env.PAYMOB_ACCOUNT_ID||!["sandbox","live"].includes(process.env.PAYMOB_MODE??""))
    throw new AppError("PAYMENT_PROVIDER_UNAVAILABLE",503,"Online payment is awaiting the agency's verified payment configuration.");
  if(integrations.some(id=>!/^\d+$/.test(id)||!Number.isSafeInteger(Number(id))))throw new AppError("PAYMENT_CONFIGURATION_ERROR",503);
  return {base,key,publicKey,integrations,environment:process.env.PAYMOB_MODE==="live"?"production":"sandbox"};
}
const responseSchema=z.object({id:z.string(),intention_order_id:z.union([z.string(),z.number().int()]),client_secret:z.string().min(1)});
export function paymentMethodIds(method:"card"|"wallet"){
  const config=paymobConfiguration();
  const configuredIds=method==="wallet"?process.env.PAYMOB_WALLET_INTEGRATION_IDS:process.env.PAYMOB_CARD_INTEGRATION_IDS??process.env.PAYMOB_INTEGRATION_IDS;
  const methods=(configuredIds??"").split(",").map(id=>id.trim()).filter(id=>config.integrations.includes(id));
  if(!methods.length)throw new AppError("PAYMENT_METHOD_UNAVAILABLE",422);
  return methods;
}
export async function createIntention(input:{id:string;amountMinor:string;currency:string;reference:string;firstName:string;lastName:string;email:string;phone:string;method:"card"|"wallet"}) {
  const config=paymobConfiguration();
  const methods=paymentMethodIds(input.method);
  const amount=Number(input.amountMinor);if(!Number.isSafeInteger(amount)||amount<=0)throw new AppError("INVALID_AMOUNT",422);
  const origin=new URL(process.env.APP_BASE_URL!).origin;
  const result=await fetch(`${config.base}/v1/intention/`,{method:"POST",headers:{"Authorization":`Token ${config.key}`,"Content-Type":"application/json"},body:JSON.stringify({
    amount,currency:input.currency,payment_methods:methods.map(Number),special_reference:input.id,
    billing_data:{first_name:input.firstName,last_name:input.lastName,email:input.email,phone_number:input.phone},
    notification_url:`${origin}/api/v1/webhooks/paymob`,redirection_url:`${origin}/en/booking/${encodeURIComponent(input.reference)}`,
    extras:{attempt_id:input.id}
  }),signal:AbortSignal.timeout(20000),redirect:"error",cache:"no-store"});
  if(!result.ok)throw new AppError("PROVIDER_REQUEST_REJECTED",502);
  const parsed=responseSchema.parse(await result.json());
  const checkout=new URL(`${config.base}/unifiedcheckout/`);checkout.searchParams.set("publicKey",config.publicKey);checkout.searchParams.set("clientSecret",parsed.client_secret);
  return {orderId:String(parsed.intention_order_id),intentionId:parsed.id,checkoutUrl:checkout.toString()};
}
export async function inquireOrder(orderId:string) {
  const config=paymobConfiguration();
  if(!/^\d+$/.test(orderId)||!process.env.PAYMOB_API_KEY)throw new AppError("RECONCILIATION_UNAVAILABLE",503);
  const response=await fetch(`${config.base}/api/auth/tokens`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({api_key:process.env.PAYMOB_API_KEY}),signal:AbortSignal.timeout(15000),redirect:"error",cache:"no-store"});
  if(!response.ok)throw new AppError("PROVIDER_AUTH_UNAVAILABLE",502);
  const {token}=z.object({token:z.string().min(1)}).parse(await response.json());
  const url=new URL(`${config.base}/api/ecommerce/orders/${orderId}`);url.searchParams.set("token",token);
  // Provider requires this query credential. This URL is never logged, exposed, or redirected.
  const order=await fetch(url,{signal:AbortSignal.timeout(15000),redirect:"error",cache:"no-store"});
  if(!order.ok)throw new AppError("PROVIDER_INQUIRY_UNAVAILABLE",502);
  return z.object({id:z.union([z.string(),z.number()]),transactions:z.array(z.unknown())}).parse(await order.json());
}
