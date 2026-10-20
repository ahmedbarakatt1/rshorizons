import {mkdir,readFile,writeFile,unlink} from "node:fs/promises";
import {dirname,resolve,sep} from "node:path";
import {createClient} from "@supabase/supabase-js";
import {MediaError} from "@/modules/photography/validation";

/** All buckets stay private, including approved marketing derivatives. URLs are never emitted. */
export interface PrivateStorage {
  readonly mode:"local-isolated"|"supabase";
  put(key:string,bytes:Buffer,mime:string):Promise<void>;
  read(key:string):Promise<Buffer>;
  remove(key:string):Promise<void>;
}
const keyPattern=/^[a-f0-9-]{36}\/(?:source|[a-f0-9-]{36})\.(?:bin|webp|mp4)$/;
function checkKey(key:string){if(!keyPattern.test(key))throw new MediaError("STORAGE_KEY_INVALID",400);}
export function localStorage(root=resolve(process.cwd(),".local/private/media")):PrivateStorage{
  if(process.env.APP_ENV==="production"||process.env.APP_ENV==="staging")throw new MediaError("LOCAL_STORAGE_FORBIDDEN",503);
  const base=resolve(/*turbopackIgnore: true*/root);
  const path=(key:string)=>{checkKey(key);const target=resolve(base,key);if(!target.startsWith(base+sep))throw new MediaError("STORAGE_KEY_INVALID",400);return target;};
  return {mode:"local-isolated",async put(key,bytes){const target=path(key);await mkdir(dirname(target),{recursive:true});await writeFile(target,bytes,{flag:"wx",mode:0o600});},async read(key){return readFile(/*turbopackIgnore: true*/path(key));},
    async remove(key){try{await unlink(path(key));}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}}};
}
export function storage():PrivateStorage{
  if(process.env.STORAGE_PROVIDER==="local"&&["development","test"].includes(process.env.APP_ENV??"development"))return localStorage();
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SECRET_KEY;
  if(process.env.STORAGE_PROVIDER!=="supabase"||!url||!key)throw new MediaError("STORAGE_NOT_CONFIGURED",503);
  const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const bucket="tourism-private";
  return {mode:"supabase",async put(object,bytes,mime){checkKey(object);const {error}=await client.storage.from(bucket).upload(object,bytes,{contentType:mime,upsert:false});if(error)throw new MediaError("STORAGE_WRITE_FAILED",503);},
    async read(object){checkKey(object);const {data,error}=await client.storage.from(bucket).download(object);if(error||!data)throw new MediaError("STORAGE_READ_FAILED",503);return Buffer.from(await data.arrayBuffer());},
    async remove(object){checkKey(object);const {error}=await client.storage.from(bucket).remove([object]);if(error)throw new MediaError("STORAGE_DELETE_FAILED",503);}};
}
