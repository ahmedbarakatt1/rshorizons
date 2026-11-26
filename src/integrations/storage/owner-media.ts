import {stat} from "node:fs/promises";
import {createReadStream} from "node:fs";
import {Readable} from "node:stream";
import {resolve} from "node:path";
import {createHash} from "node:crypto";
import photos from "@/content/owner-photos.json";
import videos from "@/content/owner-videos.json";
import {AppError} from "@/server/http/errors";
import {byteRange} from "@/server/http/byte-range";
import {storage} from "./index";

const photoKeys=new Set(["hero","diving","reef",...photos.map(photo=>photo.key)]);
const videoKeys=new Set(videos.map(video=>video.key));
function stableUuid(value:string){
 const hex=createHash("sha256").update(value).digest("hex").slice(0,32).split("");
 hex[12]="4";hex[16]=(["8","9","a","b"] as const)[Number.parseInt(hex[16],16)%4];
 const joined=hex.join("");return `${joined.slice(0,8)}-${joined.slice(8,12)}-${joined.slice(12,16)}-${joined.slice(16,20)}-${joined.slice(20)}`;
}
export function ownerMediaStorageKey(fileName:string){
 const extension=fileName.endsWith(".mp4")?"mp4":"webp";
 return `${stableUuid(`owner-media:${fileName}`)}/${stableUuid(`owner-media-file:${fileName}`)}.${extension}`;
}
export async function serveOwnerMedia(request:Request,key:string,directory=resolve(".local/media")):Promise<Response> {
 const url=new URL(request.url);
 if(!["GET","HEAD"].includes(request.method))throw new AppError("NOT_FOUND",404);
 const video=key?.endsWith(".mp4")&&videoKeys.has(key.slice(0,-4));
 const poster=key?.endsWith("-poster")&&videoKeys.has(key.slice(0,-7));
 const photo=photoKeys.has(key?.replace(/-(?:480|960|1440)$/, ""));
 if(!video&&!poster&&!photo)throw new AppError("NOT_FOUND",404);
 const fileName=video?key:`${key}.webp`,mime=video?"video/mp4":"image/webp";
 if(["production","staging"].includes(process.env.APP_ENV??"")&&process.env.MEDIA_PUBLICATION_APPROVED==="true"){
  return storage().serve(request,ownerMediaStorageKey(fileName),mime,{"Cache-Control":"public, max-age=3600, stale-while-revalidate=86400"});
 }
 if(!["development","test"].includes(process.env.APP_ENV??"development")||process.env.DEMO_MODE!=="true"||!["localhost","127.0.0.1","[::1]"].includes(url.hostname))throw new AppError("NOT_FOUND",404);
 const file=resolve(directory,fileName);
 let size:number;
 try{size=(await stat(/*turbopackIgnore: true*/file)).size;}catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")throw new AppError("NOT_FOUND",404);throw error;}
 const headers=new Headers({"Content-Type":mime,"Cache-Control":"private, max-age=300","X-Robots-Tag":"noindex","X-Content-Type-Options":"nosniff","Accept-Ranges":"bytes"});
 const range=byteRange(request.headers.get("range"),size);
 if(range==="invalid"){headers.set("Content-Range",`bytes */${size}`);return new Response(null,{status:416,headers});}
 const start=range?.start??0,end=range?.end??size-1;
 headers.set("Content-Length",String(end-start+1));
 if(range)headers.set("Content-Range",`bytes ${start}-${end}/${size}`);
 const body=request.method==="HEAD"?null:Readable.toWeb(createReadStream(/*turbopackIgnore: true*/file,{start,end})) as ReadableStream<Uint8Array>;
 return new Response(body,{status:range?206:200,headers});
}
