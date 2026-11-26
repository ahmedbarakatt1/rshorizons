import {readFile,readdir} from "node:fs/promises";
import {resolve} from "node:path";
import {createClient} from "@supabase/supabase-js";
import {ownerMediaStorageKey} from "../src/integrations/storage/owner-media.ts";

const root=resolve(".local/media");
const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SECRET_KEY;
if(!url||!key)throw new Error("Supabase production credentials are required.");
const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}}),bucket="tourism-private";
const names=(await readdir(root)).filter(name=>/^(?:hero|diving|reef|surface-swim|reef-pause|underwater-heart|open-water|boat-day|boat-cruise|evening-dining|evening-outing|evening-promenade|transfer-car|transfer-cabin|transfer-interior)(?:-(?:480|960|1440))?\.webp$|^clip-[a-z0-9-]+(?:-poster\.webp|\.mp4)$/.test(name)).sort();
let uploaded=0,existing=0;
for(const name of names){
 const object=ownerMediaStorageKey(name),bytes=await readFile(resolve(root,name)),contentType=name.endsWith(".mp4")?"video/mp4":"image/webp";
 const {error}=await client.storage.from(bucket).upload(object,bytes,{contentType,upsert:false,cacheControl:"3600"});
 if(error&&error.message.toLowerCase().includes("already exists")){existing++;continue;}
 if(error)throw new Error(`Upload failed for ${name}: ${error.message}`);
 uploaded++;
}
console.log(JSON.stringify({bucket,objects:names.length,uploaded,existing}));
