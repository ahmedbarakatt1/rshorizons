import {safeEqual} from "@/server/security";
import {sendOperationalAlert} from "@/modules/jobs/worker";
import {success,failure} from "@/server/http/request";
import {AppError} from "@/server/http/errors";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(request:Request){
  try {
    const secret=process.env.CRON_SECRET;
    if(!secret||secret.length<32||!safeEqual(request.headers.get("authorization")??"",`Bearer ${secret}`))throw new AppError("UNAUTHENTICATED",401);
    return success(await sendOperationalAlert());
  }catch(error){return failure(error);}
}
