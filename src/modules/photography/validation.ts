import {createHash} from "node:crypto";
import sharp from "sharp";
import {z} from "zod";

export const MAX_IMAGE_BYTES=20*1024*1024;
export const MAX_VIDEO_BYTES=64*1024*1024;
export const mediaMimeSchema=z.enum(["image/jpeg","image/png","image/webp","video/mp4"]);
export const uploadInputSchema=z.object({
  galleryId:z.uuid(),mimeType:mediaMimeSchema,sizeBytes:z.number().int().positive().max(MAX_VIDEO_BYTES),
  checksumSha256:z.string().regex(/^[a-f0-9]{64}$/)
}).strict().refine(v=>v.mimeType==="video/mp4"||v.sizeBytes<=MAX_IMAGE_BYTES,{message:"MEDIA_SIZE_INVALID",path:["sizeBytes"]});
export type UploadDeclaration=Omit<z.infer<typeof uploadInputSchema>,"galleryId">;
export class MediaError extends Error {
  constructor(public code:string,public status=422){super(code);this.name="MediaError";}
}
export async function validateUploadBytes(bytes:Buffer,declared:UploadDeclaration){
  const limit=declared.mimeType==="video/mp4"?MAX_VIDEO_BYTES:MAX_IMAGE_BYTES;
  if(bytes.length<1||bytes.length!==declared.sizeBytes||bytes.length>limit||declared.sizeBytes>limit)throw new MediaError("MEDIA_SIZE_INVALID");
  if(createHash("sha256").update(bytes).digest("hex")!==declared.checksumSha256)throw new MediaError("MEDIA_CHECKSUM_MISMATCH");
  const mime=bytes.subarray(0,3).equals(Buffer.from([255,216,255]))?"image/jpeg"
    :bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?"image/png"
    :bytes.toString("ascii",0,4)==="RIFF"&&bytes.toString("ascii",8,12)==="WEBP"?"image/webp"
    :bytes.toString("ascii",4,8)==="ftyp"?"video/mp4":null;
  if(mime!==declared.mimeType)throw new MediaError("MEDIA_TYPE_MISMATCH");
  // MP4 signature is only container admission, never proof of safe/transcoded playback.
  if(mime==="video/mp4")return {kind:"video" as const};
  try{
    const decoder=sharp(bytes,{failOn:"warning",limitInputPixels:40_000_000,animated:false});
    const metadata=await decoder.metadata();
    if(!metadata.width||!metadata.height||(metadata.pages??1)>1)throw new Error("unsupported dimensions/pages");
    // Full decode and re-encode discards source EXIF, scripts and trailing chunks.
    const web=await decoder.rotate().resize({width:1920,height:1920,fit:"inside",withoutEnlargement:true}).webp({quality:84}).toBuffer();
    const preview=await sharp(web).resize({width:960,height:960,fit:"inside",withoutEnlargement:true}).webp({quality:72}).toBuffer();
    const thumb=await sharp(web).resize({width:320,height:320,fit:"inside",withoutEnlargement:true}).webp({quality:68}).toBuffer();
    return {kind:"image" as const,width:metadata.width,height:metadata.height,web,preview,thumbnail:thumb};
  }catch{throw new MediaError("MEDIA_DECODE_FAILED");}
}
