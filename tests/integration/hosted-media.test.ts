import {randomUUID,createHash} from "node:crypto";
import {afterAll,afterEach,beforeAll,beforeEach,expect,it,vi} from "vitest";
import sharp from "sharp";
import {admin,makeActor} from "../database/helpers";
import {storage} from "@/integrations/storage";
import {createUploadIntent,finalizeUpload} from "@/modules/photography/service";

const provider=vi.hoisted(()=>({createSignedUploadUrl:vi.fn(),createSignedUrl:vi.fn(),download:vi.fn()}));
vi.mock("@supabase/supabase-js",()=>({createClient:()=>({storage:{from:()=>provider}})}));
const db=admin(),origin="https://storage-test.supabase.co";
beforeAll(async()=>{await db.connect();});
afterAll(async()=>{await db.end();});
beforeEach(()=>{
 vi.stubEnv("APP_ENV","test");vi.stubEnv("STORAGE_PROVIDER","supabase");
 vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL",origin);vi.stubEnv("SUPABASE_SECRET_KEY","server-only-synthetic-key");
 vi.clearAllMocks();
 provider.createSignedUploadUrl.mockImplementation(async(key:string)=>({data:{signedUrl:`${origin}/storage/v1/object/upload/sign/tourism-private/${key}?token=synthetic-upload`},error:null}));
 provider.createSignedUrl.mockImplementation(async(key:string)=>({data:{signedUrl:`${origin}/storage/v1/object/sign/tourism-private/${key}?token=synthetic-read`},error:null}));
});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
async function fixture(){
 const staffId=await makeActor(db),galleryId=randomUUID();
 await db.query("INSERT INTO app.galleries(id,kind,title) VALUES($1,'public','Synthetic hosted transport')",[galleryId]);
 const bytes=await sharp({create:{width:4,height:4,channels:3,background:"#146e80"}}).png().toBuffer();
 return {actor:{type:"staff" as const,id:staffId},galleryId,bytes,input:{galleryId,mimeType:"image/png",sizeBytes:bytes.length,checksumSha256:createHash("sha256").update(bytes).digest("hex")}};
}
it("issues a direct upload capability only after current gallery authorization and never enables overwrite",async()=>{
 const f=await fixture();
 const intent=await createUploadIntent(f.actor,f.input);
 expect(intent.uploadUrl).toBe(`${origin}/storage/v1/object/upload/sign/tourism-private/${intent.assetId}/source.bin?token=synthetic-upload`);
 expect(provider.createSignedUploadUrl).toHaveBeenCalledWith(`${intent.assetId}/source.bin`,{upsert:false});
 expect(JSON.stringify(intent)).not.toContain("server-only-synthetic-key");
 provider.createSignedUploadUrl.mockClear();
 await expect(createUploadIntent({type:"staff",id:randomUUID()},f.input)).rejects.toMatchObject({status:404});
 expect(provider.createSignedUploadUrl).not.toHaveBeenCalled();
});
it("rechecks persisted direct-upload bytes before enqueuing processing",async()=>{
 const f=await fixture(),intent=await createUploadIntent(f.actor,f.input);
 provider.download.mockResolvedValue({data:new Blob([new Uint8Array(f.bytes)]),error:null});
 expect((await finalizeUpload(intent.assetId,f.actor)).state).toBe("processing");
 const rejected=await createUploadIntent(f.actor,f.input);
 provider.download.mockResolvedValue({data:new Blob(["executable bytes"]),error:null});
 await expect(finalizeUpload(rejected.assetId,f.actor)).rejects.toThrow("MEDIA_SIZE_INVALID");
 expect((await db.query("SELECT state FROM app.media_assets WHERE id=$1",[rejected.assetId])).rows[0].state).toBe("quarantine");
 expect((await db.query("SELECT 1 FROM app.media_processing_jobs WHERE asset_id=$1",[rejected.assetId])).rowCount).toBe(0);
});
it("streams large private objects without buffering or exposing the provider URL, and preserves ranges",async()=>{
 const key=`${randomUUID()}/source.bin`,payload=new Uint8Array(5*1024*1024).fill(7);
 const upstream=new Response(new ReadableStream({start(controller){controller.enqueue(payload);controller.close();}}),{status:206,headers:{"Content-Range":`bytes 0-${payload.length-1}/${payload.length+10}`,"Content-Length":String(payload.length),"Set-Cookie":"should-not-forward=1"}});
 const fetcher=vi.fn().mockResolvedValue(upstream);vi.stubGlobal("fetch",fetcher);
 const response=await storage().serve(new Request("https://app.example.test/media",{headers:{Range:`bytes=0-${payload.length-1}`}}),key,"video/mp4",{"Cache-Control":"private, no-store"});
 expect(response.status).toBe(206);expect(response.body).toBe(upstream.body);
 expect(response.headers.get("Cache-Control")).toBe("private, no-store");
 expect(response.headers.get("Location")).toBeNull();expect(response.headers.get("Set-Cookie")).toBeNull();
 expect(response.headers.get("Content-Range")).toBe(`bytes 0-${payload.length-1}/${payload.length+10}`);
 expect(provider.download).not.toHaveBeenCalled();expect(provider.createSignedUrl).toHaveBeenCalledWith(key,60);
 expect(fetcher.mock.calls[0][1]).toMatchObject({method:"GET",redirect:"error",cache:"no-store",headers:{Range:`bytes=0-${payload.length-1}`}});
 expect((await response.arrayBuffer()).byteLength).toBe(payload.length);
});
it("rejects unsafe provider destinations and multipart ranges before fetching bytes",async()=>{
 const key=`${randomUUID()}/source.bin`,fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);
 provider.createSignedUrl.mockResolvedValue({data:{signedUrl:"https://unrelated.example.test/private?token=x"},error:null});
 await expect(storage().serve(new Request("https://app.example.test/media"),key,"image/webp",{})).rejects.toThrow("STORAGE_DESTINATION_INVALID");
 expect(fetcher).not.toHaveBeenCalled();
 const response=await storage().serve(new Request("https://app.example.test/media",{headers:{Range:"bytes=0-1,3-4"}}),key,"image/webp",{});
 expect(response.status).toBe(416);expect(fetcher).not.toHaveBeenCalled();
 provider.createSignedUploadUrl.mockResolvedValue({data:{signedUrl:"https://unrelated.example.test/private?token=x"},error:null});
 await expect(storage().createUploadUrl!(key)).rejects.toThrow("STORAGE_DESTINATION_INVALID");
});
