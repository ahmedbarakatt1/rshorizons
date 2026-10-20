import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {mkdir,mkdtemp,writeFile,readFile,rm,stat} from "node:fs/promises";
import {resolve,sep} from "node:path";
import {createHash,createHmac,createSign,timingSafeEqual} from "node:crypto";
import sharp from "sharp";
import {z} from "zod";
import {MediaError} from "@/modules/photography/validation";
import {query,withTransaction} from "@/server/db";
type ProcessedVideo={bytes:Buffer;poster:Buffer;width:number;height:number;durationMs:number};
const execute=promisify(execFile),maxBytes=64*1024*1024;
export async function transcodeLocalVideo(bytes:Buffer):Promise<ProcessedVideo>{
  if(!["development","test"].includes(process.env.APP_ENV??"development"))throw new MediaError("LOCAL_VIDEO_PROCESSOR_FORBIDDEN",503);
  if(bytes.length>maxBytes||bytes.length<16)throw new MediaError("VIDEO_DECODE_FAILED");
  const base=resolve(".local/video-jobs");await mkdir(base,{recursive:true});const folder=await mkdtemp(resolve(base,"job-"));
  const source=resolve(folder,"input.mp4"),output=resolve(folder,"output.mp4"),poster=resolve(folder,"poster.webp");
  try{
    await writeFile(source,bytes,{flag:"wx",mode:0o600});
    const probe=await execute(process.env.FFPROBE_PATH??"ffprobe",["-v","error","-protocol_whitelist","file,pipe","-f","mov","-show_streams","-show_format","-of","json",source],{windowsHide:true,timeout:15000,maxBuffer:1024*1024});
    const parsed=z.object({streams:z.array(z.object({codec_type:z.string(),width:z.number().optional(),height:z.number().optional()})),format:z.object({duration:z.coerce.number().positive().max(900)})}).parse(JSON.parse(probe.stdout));
    const video=parsed.streams.find(s=>s.codec_type==="video");
    if(!video?.width||!video.height||video.width>8192||video.height>8192)throw new Error("INVALID_VIDEO_DIMENSIONS");
    const width=Math.floor(Math.min(1280,video.width)/2)*2,height=Math.floor(video.height*width/video.width/2)*2;
    const common=["-hide_banner","-loglevel","error","-nostdin","-protocol_whitelist","file,pipe","-f","mov","-i",source];
    await execute(process.env.FFMPEG_PATH??"ffmpeg",[...common,"-map","0:v:0","-map","0:a:0?","-map_metadata","-1","-map_metadata:s","-1","-map_chapters","-1","-vf",`scale=${width}:${height},fps=30`,"-c:v","libx264","-preset","fast","-crf","25","-pix_fmt","yuv420p","-c:a","aac","-b:a","128k","-movflags","+faststart","-threads","2","-t","900","-y",output],{windowsHide:true,timeout:90000,maxBuffer:1024*1024});
    if((await stat(output)).size>maxBytes)throw new Error("VIDEO_OUTPUT_TOO_LARGE");
    await execute(process.env.FFMPEG_PATH??"ffmpeg",[...common,"-frames:v","1","-vf","scale=800:-2","-map_metadata","-1","-y",poster],{windowsHide:true,timeout:20000,maxBuffer:1024*1024});
    const cleanPoster=await sharp(await readFile(poster)).rotate().webp({quality:80}).toBuffer();
    return {bytes:await readFile(output),poster:cleanPoster,width,height,durationMs:Math.round(parsed.format.duration*1000)};
  }catch(error){if(error instanceof MediaError)throw error;throw new MediaError("VIDEO_DECODE_FAILED",422);}
  finally{
    // Computed recursive cleanup is restricted to this invocation's workspace job directory.
    const target=resolve(folder);if(target.startsWith(base+sep)&&target!==base)await rm(target,{recursive:true,force:true});
  }
}
export function verifyMuxSignature(raw:string,header:string,secret:string,now=Math.floor(Date.now()/1000)){
  const values=header.split(",").map(p=>p.trim().split("=")),timestamp=values.find(p=>p[0]==="t")?.[1];
  if(!secret||!timestamp||!/^\d+$/.test(timestamp)||Math.abs(now-Number(timestamp))>300)return false;
  const expected=createHmac("sha256",secret).update(`${timestamp}.${raw}`).digest();
  return values.filter(p=>p[0]==="v1"&&/^[a-f0-9]{64}$/i.test(p[1]??"")).some(p=>timingSafeEqual(expected,Buffer.from(p[1],"hex")));
}
function muxConfig(){
  const id=process.env.VIDEO_API_TOKEN_ID,secret=process.env.VIDEO_API_TOKEN,signingId=process.env.VIDEO_SIGNING_KEY_ID,privateKey=process.env.VIDEO_SIGNING_PRIVATE_KEY;
  if(process.env.VIDEO_PROVIDER!=="mux"||!id||!secret||!signingId||!privateKey)throw new MediaError("VIDEO_PROCESSOR_NOT_CONFIGURED",503);
  return {authorization:`Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,signingId,privateKey:Buffer.from(privateKey,"base64").toString("utf8")};
}
async function muxRequest(path:string,body?:unknown) {
  if(!/^\/(?:uploads|assets)(?:\/[A-Za-z0-9]+)?$/.test(path))throw new MediaError("VIDEO_PROVIDER_REFERENCE_INVALID");
  const response=await fetch(`https://api.mux.com/video/v1${path}`,{method:body?"POST":"GET",headers:{Authorization:muxConfig().authorization,"Content-Type":"application/json"},...body?{body:JSON.stringify(body)}:{},redirect:"error",cache:"no-store",signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new MediaError("VIDEO_PROVIDER_UNAVAILABLE",503);
  return z.object({data:z.record(z.string(),z.unknown())}).parse(await response.json()).data;
}
function signedResource(playbackId:string,audience:"v"|"t"){
  if(!/^[A-Za-z0-9]+$/.test(playbackId))throw new MediaError("VIDEO_PROVIDER_REFERENCE_INVALID");
  const config=muxConfig(),head=Buffer.from(JSON.stringify({alg:"RS256",typ:"JWT"})).toString("base64url"),claims=Buffer.from(JSON.stringify({sub:playbackId,aud:audience,exp:Math.floor(Date.now()/1000)+300,kid:config.signingId,...audience==="t"?{width:800,time:0}:{}})).toString("base64url");
  const unsigned=`${head}.${claims}`,signature=createSign("RSA-SHA256").update(unsigned).sign(config.privateKey,"base64url");
  return `${unsigned}.${signature}`;
}
async function boundedDownload(url:URL,limit=maxBytes) {
  const response=await fetch(url,{cache:"no-store",redirect:"error",signal:AbortSignal.timeout(30000)});
  if(!response.ok||Number(response.headers.get("content-length")??0)>limit)throw new MediaError("VIDEO_DERIVATIVE_UNAVAILABLE",503);
  const reader=response.body?.getReader();if(!reader)throw new MediaError("VIDEO_DERIVATIVE_UNAVAILABLE",503);
  const chunks:Uint8Array[]=[];let total=0;
  for(;;){const {value,done}=await reader.read();if(done)break;total+=value.byteLength;if(total>limit){await reader.cancel();throw new MediaError("VIDEO_OUTPUT_TOO_LARGE",422);}chunks.push(value);}
  return Buffer.concat(chunks);
}
export async function processPrivateVideo(assetId:string,bytes:Buffer):Promise<ProcessedVideo>{
  if(process.env.VIDEO_PROVIDER==="local"&&["development","test"].includes(process.env.APP_ENV??"development"))return transcodeLocalVideo(bytes);
  muxConfig();z.guid().parse(assetId);
  if(!process.env.VIDEO_ENVIRONMENT_ID)throw new MediaError("VIDEO_ENVIRONMENT_MISMATCH",503);
  let row=(await query("SELECT * FROM app.video_ingestions WHERE asset_id=$1",[assetId])).rows[0];
  if(!row){
    const claim=await query("INSERT INTO app.video_ingestions(asset_id,provider,state,attempt_key,provider_environment) VALUES($1::uuid,'mux','creating',$1::uuid::text,$2) ON CONFLICT DO NOTHING RETURNING asset_id",[assetId,process.env.VIDEO_ENVIRONMENT_ID]);
    if(!claim.rowCount)throw new MediaError("VIDEO_PROCESSING_PENDING",503);
    try{
      const upload=z.object({id:z.string().regex(/^[A-Za-z0-9]+$/),url:z.url()}).parse(await muxRequest("/uploads",{timeout:3600,new_asset_settings:{playback_policies:["signed"],video_quality:"basic",static_renditions:[{resolution:"highest"}],passthrough:assetId}}));
      const target=new URL(upload.url);
      if(target.protocol!=="https:"||!(target.hostname==="storage.googleapis.com"||target.hostname.endsWith(".storage.googleapis.com")))throw new MediaError("VIDEO_UPLOAD_DESTINATION_REJECTED",503);
      await query("UPDATE app.video_ingestions SET provider_upload_id=$2,state='uploading' WHERE asset_id=$1",[assetId,upload.id]);
      const sent=await fetch(target,{method:"PUT",headers:{"Content-Type":"video/mp4"},body:new Uint8Array(bytes),redirect:"error",signal:AbortSignal.timeout(45000)});
      if(!sent.ok)throw new MediaError("VIDEO_UPLOAD_FAILED",503);
      await query("UPDATE app.video_ingestions SET state='processing' WHERE asset_id=$1",[assetId]);
    }catch(error){await query("UPDATE app.video_ingestions SET state='unknown' WHERE asset_id=$1",[assetId]);throw error;}
    throw new MediaError("VIDEO_PROCESSING_PENDING",503);
  }
  if(row.provider_environment!==process.env.VIDEO_ENVIRONMENT_ID)throw new MediaError("VIDEO_ENVIRONMENT_MISMATCH",503);
  if(!row.provider_upload_id)throw new MediaError("VIDEO_UPLOAD_RECONCILIATION_REQUIRED",503);
  if(!row.provider_asset_id){
    const upload=await muxRequest(`/uploads/${row.provider_upload_id}`);
    if(!upload.asset_id)throw new MediaError("VIDEO_PROCESSING_PENDING",503);
    const id=z.string().regex(/^[A-Za-z0-9]+$/).parse(upload.asset_id);
    await query("UPDATE app.video_ingestions SET provider_asset_id=$2,state='processing' WHERE asset_id=$1",[assetId,id]);row={...row,provider_asset_id:id};
  }
  const providerAsset=await muxRequest(`/assets/${row.provider_asset_id}`);
  if(providerAsset.status==="errored")throw new MediaError("VIDEO_DECODE_FAILED",422);
  if(providerAsset.status!=="ready")throw new MediaError("VIDEO_PROCESSING_PENDING",503);
  const asset=z.object({status:z.string(),passthrough:z.string(),duration:z.number().positive().max(900),playback_ids:z.array(z.object({id:z.string(),policy:z.string()})),tracks:z.array(z.object({type:z.string(),max_width:z.number().optional(),max_height:z.number().optional()})),static_renditions:z.object({files:z.array(z.object({name:z.string(),status:z.string(),ext:z.string()}))}).optional()}).parse(providerAsset);
  if(asset.passthrough!==assetId)throw new MediaError("VIDEO_CORRELATION_MISMATCH",422);
  if(asset.status==="errored")throw new MediaError("VIDEO_DECODE_FAILED",422);
  const playback=asset.playback_ids.find(p=>p.policy==="signed"),file=asset.static_renditions?.files.find(f=>f.status==="ready"&&f.ext==="mp4"),track=asset.tracks.find(t=>t.type==="video");
  if(asset.status!=="ready"||!playback||!file||!track?.max_width||!track.max_height)throw new MediaError("VIDEO_PROCESSING_PENDING",503);
  if(!/^[A-Za-z0-9_.-]+\.mp4$/.test(file.name))throw new MediaError("VIDEO_PROVIDER_REFERENCE_INVALID");
  const videoUrl=new URL(`https://stream.mux.com/${playback.id}/${file.name}`);videoUrl.searchParams.set("token",signedResource(playback.id,"v"));
  const posterUrl=new URL(`https://image.mux.com/${playback.id}/thumbnail.webp`);posterUrl.searchParams.set("token",signedResource(playback.id,"t"));
  const [result,poster]=await Promise.all([boundedDownload(videoUrl),boundedDownload(posterUrl,5*1024*1024)]);
  if(result.toString("ascii",4,8)!=="ftyp")throw new MediaError("VIDEO_DERIVATIVE_INVALID");
  const cleanPoster=await sharp(poster).rotate().webp({quality:80}).toBuffer();
  await query("UPDATE app.video_ingestions SET state='ready' WHERE asset_id=$1",[assetId]);
  return {bytes:result,poster:cleanPoster,width:track.max_width,height:track.max_height,durationMs:Math.round(asset.duration*1000)};
}
/** Only approved retention may delete a known, tombstoned provider asset. */
export async function purgeManagedVideo(assetId:string){
  if(process.env.RETENTION_POLICY_APPROVED!=="true")throw new MediaError("RETENTION_POLICY_UNAPPROVED",503);
  const row=(await query("SELECT v.*,a.state AS asset_state FROM app.video_ingestions v JOIN app.media_assets a ON a.id=v.asset_id WHERE v.asset_id=$1",[z.guid().parse(assetId)])).rows[0];
  if(!row||row.provider==="local")return;
  if(row.asset_state!=="deleted")throw new MediaError("VIDEO_RETENTION_NOT_TOMBSTONED",409);
  if(row.provider!=="mux"||!row.provider_environment||row.provider_environment!==process.env.VIDEO_ENVIRONMENT_ID)throw new MediaError("VIDEO_ENVIRONMENT_MISMATCH",503);
  let providerId=row.provider_asset_id as string|null;
  if(!providerId&&row.provider_upload_id){
    const upload=await muxRequest(`/uploads/${row.provider_upload_id}`);
    if(upload.asset_id){
      providerId=z.string().regex(/^[A-Za-z0-9]+$/).parse(upload.asset_id);
      await query("UPDATE app.video_ingestions SET provider_asset_id=$2 WHERE asset_id=$1",[assetId,providerId]);
    }else if(["cancelled","timed_out","errored"].includes(String(upload.status)))return;
    else throw new MediaError("VIDEO_UPLOAD_RECONCILIATION_REQUIRED",503);
  }
  if(!providerId||!/^[A-Za-z0-9]+$/.test(providerId))throw new MediaError("VIDEO_UPLOAD_RECONCILIATION_REQUIRED",503);
  const target=`https://api.mux.com/video/v1/assets/${providerId}`,headers={Authorization:muxConfig().authorization};
  const current=await fetch(target,{headers,redirect:"error",cache:"no-store",signal:AbortSignal.timeout(15000)});
  if(current.status===404)return; // Retry after a previously successful DELETE.
  if(!current.ok)throw new MediaError("VIDEO_PROVIDER_UNAVAILABLE",503);
  const info=z.object({data:z.object({passthrough:z.string()})}).parse(await current.json());
  if(info.data.passthrough!==assetId)throw new MediaError("VIDEO_CORRELATION_MISMATCH",422);
  const deleted=await fetch(target,{method:"DELETE",headers,redirect:"error",cache:"no-store",signal:AbortSignal.timeout(15000)});
  if(!deleted.ok&&deleted.status!==404)throw new MediaError("VIDEO_RETENTION_FAILED",503);
}
export async function muxWebhook(raw:string,signature:string){
  if(!verifyMuxSignature(raw,signature,process.env.VIDEO_WEBHOOK_SECRET??""))throw new MediaError("INVALID_SIGNATURE",401);
  const event=z.object({id:z.string().min(1).max(200),type:z.string(),data:z.record(z.string(),z.unknown()),environment:z.object({id:z.string()})}).parse(JSON.parse(raw));
  if(!process.env.VIDEO_ENVIRONMENT_ID||event.environment.id!==process.env.VIDEO_ENVIRONMENT_ID)throw new MediaError("VIDEO_ENVIRONMENT_MISMATCH",403);
  const hash=createHash("sha256").update(raw).digest("hex");
  return withTransaction({type:"system"},async tx=>{
    const recorded=await tx.query("INSERT INTO app.provider_webhook_events(id,provider,event_type,body_hash) VALUES($1,'mux',$2,$3) ON CONFLICT DO NOTHING RETURNING id",[event.id,event.type,hash]);
    if(!recorded.rowCount)return {duplicate:true};
    const providerAssetId=typeof event.data.asset_id==="string"?event.data.asset_id:event.data.id;
    const ingestion=await tx.query("SELECT asset_id FROM app.video_ingestions WHERE provider_asset_id=$1 OR provider_upload_id=$2",[providerAssetId,typeof event.data.upload_id==="string"?event.data.upload_id:null]);
    if(ingestion.rows[0]&&["video.asset.ready","video.asset.static_rendition.ready","video.upload.asset_created"].includes(event.type)){
      await tx.query("UPDATE app.jobs SET status='pending',attempts=0,run_after=now(),failure_class=NULL WHERE event_id IN(SELECT id FROM app.outbox_events WHERE aggregate_id=$1 AND event_type='media_processing') AND status IN('failed','dead')",[ingestion.rows[0].asset_id]);
    }
    return {accepted:true};
  });
}
