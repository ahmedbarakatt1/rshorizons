import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {mkdir,readFile} from "node:fs/promises";
import {resolve} from "node:path";
import {createHmac} from "node:crypto";
import {test,expect,vi,afterEach} from "vitest";
import {transcodeLocalVideo,verifyMuxSignature,purgeManagedVideo} from "@/integrations/video";
import {admin,makeActor} from "../database/helpers";
import {randomUUID} from "node:crypto";
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
test("video_decodes_and_transcodes_real_bytes_with_private_poster",async()=>{
  const dir=resolve(".local/video-test");await mkdir(dir,{recursive:true});
  const path=resolve(dir,"synthetic.mp4");
  await promisify(execFile)(process.env.FFMPEG_PATH??"ffmpeg",["-hide_banner","-loglevel","error","-f","lavfi","-i","color=c=navy:s=320x240:d=1","-metadata","title=private fixture","-c:v","libx264","-pix_fmt","yuv420p","-y",path],{windowsHide:true,timeout:20000});
  const result=await transcodeLocalVideo(await readFile(path));
  expect(result.width).toBe(320);expect(result.height).toBe(240);expect(result.bytes.toString("ascii",4,8)).toBe("ftyp");
  expect(result.poster.length).toBeGreaterThan(100);expect(result.bytes.includes(Buffer.from("private fixture"))).toBe(false);
  await expect(transcodeLocalVideo(Buffer.from("not an mp4"))).rejects.toMatchObject({code:"VIDEO_DECODE_FAILED"});
},60000);
test("mux_webhook_rejects_invalid_signature_and_replay_timestamp",()=>{
  const raw='{"id":"synthetic","type":"video.asset.ready"}',timestamp=Math.floor(Date.now()/1000);
  const hash=createHmac("sha256","test-secret").update(`${timestamp}.${raw}`).digest("hex");
  expect(verifyMuxSignature(raw,`t=${timestamp},v1=${hash}`,"test-secret")).toBe(true);
  expect(verifyMuxSignature(raw+" ",`t=${timestamp},v1=${hash}`,"test-secret")).toBe(false);
  expect(verifyMuxSignature(raw,`t=${timestamp-400},v1=${hash}`,"test-secret")).toBe(false);
});
test("managed_video_retention_requires_tombstone_environment_and_provider_correlation",async()=>{
 const db=admin();await db.connect();
 try{
  const actor=await makeActor(db),id=randomUUID();
  await db.query("INSERT INTO app.media_assets(id,storage_bucket,storage_key,uploaded_by,mime_type,size_bytes,checksum_sha256,state) VALUES($1,'tourism-private',$2,$3,'video/mp4',100,$4,'deleted')",[id,`${id}/video.mp4`,actor,"a".repeat(64)]);
  await db.query("INSERT INTO app.video_ingestions(asset_id,provider,provider_asset_id,state,attempt_key,provider_environment) VALUES($1::uuid,'mux',$2,'ready',$1::uuid::text,'SyntheticEnvironment')",[id,`Synthetic${id.replaceAll("-","")}`]);
  for(const [key,value] of Object.entries({VIDEO_PROVIDER:"mux",VIDEO_ENVIRONMENT_ID:"SyntheticEnvironment",VIDEO_API_TOKEN_ID:"synthetic",VIDEO_API_TOKEN:"synthetic",VIDEO_SIGNING_KEY_ID:"synthetic",VIDEO_SIGNING_PRIVATE_KEY:"c3ludGhldGlj",RETENTION_POLICY_APPROVED:"true"}))vi.stubEnv(key,value);
  const fetcher=vi.fn().mockResolvedValueOnce(Response.json({data:{passthrough:"wrong-id"}}));vi.stubGlobal("fetch",fetcher);
  await expect(purgeManagedVideo(id)).rejects.toMatchObject({code:"VIDEO_CORRELATION_MISMATCH"});
  expect(fetcher).toHaveBeenCalledTimes(1);
  fetcher.mockReset().mockResolvedValueOnce(Response.json({data:{passthrough:id}})).mockResolvedValueOnce(new Response(null,{status:204}));
  await purgeManagedVideo(id);
  expect(fetcher.mock.calls[1][1].method).toBe("DELETE");
  fetcher.mockReset();vi.stubEnv("VIDEO_ENVIRONMENT_ID","WrongEnvironment");
  await expect(purgeManagedVideo(id)).rejects.toMatchObject({code:"VIDEO_ENVIRONMENT_MISMATCH"});expect(fetcher).not.toHaveBeenCalled();
 }finally{await db.end();}
});
