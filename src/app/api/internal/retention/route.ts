import {safeEqual} from "@/server/security";
import {cleanupExpiredMedia} from "@/modules/photography/retention";
import {cleanupExpiredContacts} from "@/modules/content/contact-retention";
import {success,failure} from "@/server/http/request";
import {AppError} from "@/server/http/errors";

export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=300;

export async function GET(request:Request){
  try{
    const secret=process.env.CRON_SECRET;
    if(!secret||secret.length<32||!safeEqual(request.headers.get("authorization")??"",`Bearer ${secret}`))throw new AppError("UNAUTHENTICATED",401);
    const result=await cleanupExpiredMedia({dryRun:process.env.RETENTION_POLICY_APPROVED!=="true",limit:25});
    const contacts=await cleanupExpiredContacts({dryRun:process.env.RETENTION_POLICY_APPROVED!=="true",limit:25});
    const counts={dryRun:result.dryRun,eligible:result.eligibleAssetIds.length,purged:result.purgedAssetIds.length,failed:result.failedAssetIds.length,contactsEligible:contacts.eligibleIds.length,contactsPurged:contacts.purgedIds.length};
    if(counts.failed)throw new AppError("MEDIA_RETENTION_INCOMPLETE",503);
    return success(counts);
  }catch(error){return failure(error);}
}
