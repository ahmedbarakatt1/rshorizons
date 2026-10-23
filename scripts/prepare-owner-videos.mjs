// Offline preparation only. Originals and derivatives remain outside Git and deployment.
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {readFile,writeFile,mkdir,rename} from "node:fs/promises";
import {createHash} from "node:crypto";
import {resolve} from "node:path";
import sharp from "sharp";
const execute=promisify(execFile),directory=resolve(".local/media");
const selections=[
 ["GX019474.MP4","dolphins"],["GX017027.MP4","turtle"],["GX017023.MP4","dugong"],
 ["GX017041.MP4","reefLife"],["GX013777.MP4","snorkeler"],["GX011348.MP4","moray"],
 ...["GX010123","GX010345","GX010870","GX011544","GX012050","GX012662","GX019157","GX019247","GX019326","fm sun  (20)","stone"].map(n=>[`${n}.MP4`,"reefLife"]),
 ...["GX010356","GX010697","GX011517","GX011612","GX017017","GX017113","GX017119","GX019591","turtele"].map(n=>[`${n}.MP4`,"turtle"]),
 ["GX017014.MP4","diver"],["GX017512.MP4","dugong"],["GX017583.MP4","dugong"],["GX019473.MP4","dolphins"]
];
await mkdir(directory,{recursive:true});await mkdir("src/content",{recursive:true});
const records=[],provenance=[];
for(const [source,captionKey] of selections){
 const key=`clip-${source.replace(/\.MP4$/i,"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/-$/,"")}`;
 const output=resolve(directory,`.preparing-${key}.mp4`),poster=resolve(directory,`${key}-poster.webp`);
 await execute("ffmpeg",["-v","error","-nostdin","-i",resolve("media",source),"-map","0:v:0","-an","-map_metadata","-1","-map_chapters","-1","-vf","scale=960:960:force_original_aspect_ratio=decrease:force_divisible_by=2,fps=30","-c:v","libx264","-preset","fast","-crf","28","-pix_fmt","yuv420p","-movflags","+faststart","-threads","2","-y",output],{windowsHide:true,timeout:180000});
 const {stdout}=await execute("ffprobe",["-v","error","-show_entries","stream=width,height,codec_type:format=duration,size","-of","json",output],{windowsHide:true});
 const info=JSON.parse(stdout),video=info.streams.find(s=>s.codec_type==="video");
 const {stdout:frame}=await execute("ffmpeg",["-v","error","-ss","1","-i",output,"-frames:v","1","-f","image2pipe","-c:v","png","pipe:1"],{windowsHide:true,encoding:"buffer",maxBuffer:8*1024*1024});
 await sharp(frame).resize({width:480,withoutEnlargement:true}).webp({quality:75}).toFile(poster);
 const ready=resolve(directory,`${key}.mp4`);await rename(output,ready);
 records.push({key,captionKey,width:video.width,height:video.height,duration:Math.round(Number(info.format.duration)*10)/10});
 const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
 provenance.push({key,source,sourceSha256:sha(await readFile(resolve("media",source))),derivativeSha256:sha(await readFile(ready)),bytes:Number(info.format.size),audioRemoved:true,metadataRemoved:true,ownerAssetUseAuthorizedOn:"2026-10-24",productionPublicationApproved:false,servingScope:"loopback-local-preview"});
 console.log(`${records.length}/${selections.length}: ${key}`);
}
await writeFile("src/content/owner-videos.json",JSON.stringify(records,null,2)+"\n");
await writeFile(resolve(directory,"owner-video-manifest.json"),JSON.stringify(provenance,null,2)+"\n");
