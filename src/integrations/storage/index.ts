import {mkdir,readFile,writeFile,unlink} from "node:fs/promises";
import {dirname,resolve,sep} from "node:path";
import {createClient} from "@supabase/supabase-js";
import {MediaError} from "@/modules/photography/validation";
import {mediaResponse} from "@/server/http/byte-range";

/** All buckets stay private. Only scoped upload capabilities may leave the server. */
export interface PrivateStorage {
  readonly mode:"local-isolated"|"supabase";
  put(key:string,bytes:Buffer,mime:string):Promise<void>;
  read(key:string):Promise<Buffer>;
  remove(key:string):Promise<void>;
  createUploadUrl?(key:string):Promise<string>;
  serve(request:Request,key:string,mime:string,headers:Record<string,string>):Promise<Response>;
}
const keyPattern=/^[a-f0-9-]{36}\/(?:source|[a-f0-9-]{36})\.(?:bin|webp|mp4)$/;
function checkKey(key:string){if(!keyPattern.test(key))throw new MediaError("STORAGE_KEY_INVALID",400);}
export function localStorage(root=resolve(process.cwd(),".local/private/media")):PrivateStorage{
  if(process.env.APP_ENV==="production"||process.env.APP_ENV==="staging")throw new MediaError("LOCAL_STORAGE_FORBIDDEN",503);
  const base=resolve(/*turbopackIgnore: true*/root);
  const path=(key:string)=>{checkKey(key);const target=resolve(base,key);if(!target.startsWith(base+sep))throw new MediaError("STORAGE_KEY_INVALID",400);return target;};
  return {mode:"local-isolated",async put(key,bytes){const target=path(key);await mkdir(dirname(target),{recursive:true});await writeFile(target,bytes,{flag:"wx",mode:0o600});},async read(key){return readFile(/*turbopackIgnore: true*/path(key));},
    async serve(request,key,mime,headers){return mediaResponse(request,await readFile(/*turbopackIgnore: true*/path(key)),mime,headers);},
    async remove(key){try{await unlink(path(key));}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}}};
}
export function storage():PrivateStorage{
  if(process.env.STORAGE_PROVIDER==="local"&&["development","test"].includes(process.env.APP_ENV??"development"))return localStorage();
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SECRET_KEY;
  if(process.env.STORAGE_PROVIDER!=="supabase"||!url||!key)throw new MediaError("STORAGE_NOT_CONFIGURED",503);
  const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const bucket="tourism-private";
  const checkedUrl=(signed:string,object:string,upload=false)=>{
    let target:URL;try{target=new URL(signed);}catch{throw new MediaError("STORAGE_DESTINATION_INVALID",503);}
    const expected=new URL(url);
    if(target.protocol!=="https:"||target.origin!==expected.origin||target.username||target.password||target.hash||
      target.pathname!==`/storage/v1/object/${upload?"upload/sign":"sign"}/${bucket}/${object}`||!target.searchParams.get("token"))throw new MediaError("STORAGE_DESTINATION_INVALID",503);
    return target;
  };
  return {mode:"supabase",async put(object,bytes,mime){checkKey(object);const {error}=await client.storage.from(bucket).upload(object,bytes,{contentType:mime,upsert:false});if(error)throw new MediaError("STORAGE_WRITE_FAILED",503);},
    async read(object){checkKey(object);const {data,error}=await client.storage.from(bucket).download(object);if(error||!data)throw new MediaError("STORAGE_READ_FAILED",503);return Buffer.from(await data.arrayBuffer());},
    async createUploadUrl(object){
      checkKey(object);
      const {data,error}=await client.storage.from(bucket).createSignedUploadUrl(object,{upsert:false});
      if(error||!data)throw new MediaError("STORAGE_UPLOAD_UNAVAILABLE",503);
      return checkedUrl(data.signedUrl,object,true).toString();
    },
    async serve(request,object,mime,baseHeaders){
      checkKey(object);
      const headers=new Headers({...baseHeaders,"Content-Type":mime,"Accept-Ranges":"bytes","X-Content-Type-Options":"nosniff"});
      const range=request.headers.get("range");
      if(range&&!/^bytes=(?:\d+-\d*|-\d+)$/.test(range))return new Response(null,{status:416,headers});
      const {data,error}=await client.storage.from(bucket).createSignedUrl(object,60);
      if(error||!data)throw new MediaError("STORAGE_READ_FAILED",503);
      // The signed read capability stays on the server; every new request rechecks
      // current gallery rights. Stream the body to avoid the host's buffered payload limit.
      const target=checkedUrl(data.signedUrl,object);
      const response=await fetch(target,{method:request.method==="HEAD"?"HEAD":"GET",headers:range?{Range:range}:{},redirect:"error",cache:"no-store",signal:AbortSignal.any([request.signal,AbortSignal.timeout(240000)])});
      if(![200,206,416].includes(response.status)){await response.body?.cancel();throw new MediaError("STORAGE_READ_FAILED",503);}
      for(const name of ["Content-Length","Content-Range"]) {const value=response.headers.get(name);if(value)headers.set(name,value);}
      if(request.method==="HEAD"||response.status===416){await response.body?.cancel();return new Response(null,{status:response.status,headers});}
      if(!response.body)throw new MediaError("STORAGE_READ_FAILED",503);
      return new Response(response.body,{status:response.status,headers});
    },
    async remove(object){checkKey(object);const {error}=await client.storage.from(bucket).remove([object]);if(error)throw new MediaError("STORAGE_DELETE_FAILED",503);}};
}
