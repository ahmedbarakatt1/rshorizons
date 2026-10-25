import {publicRoute} from "./public";
import {adminReads} from "./admin-reads";
import {adminWrites} from "./admin-writes";
import {authRoute} from "./auth";
import {assertOrigin} from "@/server/security";
import {failure,readJson,readRawBody,success,idempotencyKey} from "@/server/http/request";
import {AppError} from "@/server/http/errors";
import {getGuest} from "@/server/auth";
import {paymobWebhook,startPayment} from "@/modules/payments/service";
import {verifyMessagingWebhook,applyMessagingWebhook} from "@/integrations/messaging/notifications";
import {muxWebhook} from "@/integrations/video";
export async function route(request:Request,parts:string[]) {
  try {
    if(parts[0]==="webhooks"&&parts[1]==="paymob"&&request.method==="POST")
      return success(await paymobWebhook(await readJson(request,256*1024),new URL(request.url).searchParams.get("hmac")??""));
    if(parts[0]==="webhooks"&&parts.length===2) {
      if(["openwa","whatsapp"].includes(parts[1]))throw new AppError("NOT_FOUND",404);
      if(request.method==="POST"&&parts[1]==="resend")
        return success(await applyMessagingWebhook(verifyMessagingWebhook("resend",await readRawBody(request),request.headers)));
      if(request.method==="POST"&&parts[1]==="mux")return success(await muxWebhook(await readRawBody(request),request.headers.get("mux-signature")??""));
    }
    if(!["GET","HEAD","OPTIONS"].includes(request.method))assertOrigin(request,process.env.APP_BASE_URL??"http://127.0.0.1:3000");
    if(parts[0]==="admin") {
      const response=await authRoute(request,parts)??await adminReads(request,parts)??await adminWrites(request,parts);
      if(response)return response;
    }else{
      if(parts[0]==="bookings"&&parts[2]==="payment-attempts"&&request.method==="POST")
        return success(await startPayment(await getGuest(request,parts[1]),await readJson(request),idempotencyKey(request)),201);
      const response=await publicRoute(request,parts);if(response)return response;
    }
    throw new AppError("NOT_FOUND",404);
  }catch(error){return failure(error);}
}
