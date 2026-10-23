import {stat} from "node:fs/promises";
import {createReadStream} from "node:fs";
import {Readable} from "node:stream";
import {resolve} from "node:path";
import photos from "@/content/owner-photos.json";
import videos from "@/content/owner-videos.json";
import {AppError} from "@/server/http/errors";
import {byteRange} from "@/server/http/byte-range";

const photoKeys=new Set(["hero","diving","reef",...photos.map(photo=>photo.key)]);
const videoKeys=new Set(videos.map(video=>video.key));
export async function serveOwnerMedia(request:Request,key:string,directory=resolve(".local/media")):Promise<Response> {
 const url=new URL(request.url);
 if(!["GET","HEAD"].includes(request.method)||!["development","test"].includes(process.env.APP_ENV??"development")||process.env.DEMO_MODE!=="true"||!["localhost","127.0.0.1","[::1]"].includes(url.hostname))throw new AppError("NOT_FOUND",404);
 const video=key?.endsWith(".mp4")&&videoKeys.has(key.slice(0,-4));
 const poster=key?.endsWith("-poster")&&videoKeys.has(key.slice(0,-7));
 const photo=photoKeys.has(key?.replace(/-(?:480|960|1440)$/, ""));
 if(!video&&!poster&&!photo)throw new AppError("NOT_FOUND",404);
 const file=resolve(directory,video?key:`${key}.webp`);
 let size:number;
 try{size=(await stat(/*turbopackIgnore: true*/file)).size;}catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")throw new AppError("NOT_FOUND",404);throw error;}
 const headers=new Headers({"Content-Type":video?"video/mp4":"image/webp","Cache-Control":"private, max-age=300","X-Robots-Tag":"noindex","X-Content-Type-Options":"nosniff","Accept-Ranges":"bytes"});
 const range=byteRange(request.headers.get("range"),size);
 if(range==="invalid"){headers.set("Content-Range",`bytes */${size}`);return new Response(null,{status:416,headers});}
 const start=range?.start??0,end=range?.end??size-1;
 headers.set("Content-Length",String(end-start+1));
 if(range)headers.set("Content-Range",`bytes ${start}-${end}/${size}`);
 const body=request.method==="HEAD"?null:Readable.toWeb(createReadStream(/*turbopackIgnore: true*/file,{start,end})) as ReadableStream<Uint8Array>;
 return new Response(body,{status:range?206:200,headers});
}
