/* global console */
// Run from repository root: node src/integrations/storage/prepare-owner-media.mjs
// Owner authorized use of the supplied folder on 2026-10-20. Subject consent remains a production gate.
import sharp from "sharp";
import {createHash} from "node:crypto";
import {readFile,writeFile,mkdir} from "node:fs/promises";
import {resolve} from "node:path";
const directory=resolve(".local/media");
await mkdir(directory,{recursive:true});
const selections=[
  {key:"hero",source:"GP017062.JPG",caption:"A diver above the reef"},
  {key:"diving",source:"GP011375.JPG",caption:"A diver beneath the surface"},
  {key:"reef",source:"GP011387.JPG",caption:"A diver beside the reef"},
  {key:"surface-swim",source:"GP017035.JPG",caption:"A snorkeler below the surface"},
  {key:"reef-pause",source:"GP011729.JPG",caption:"A diver beside a coral reef"},
  {key:"underwater-heart",source:"GP011377.JPG",caption:"A diver making a heart gesture underwater"},
  {key:"open-water",source:"GP017063.JPG",caption:"A diver above the seabed"},
  ...[
    ["boat-day","7.39.04 PM","Boat on the sea"],
    ["boat-cruise","7.39.31 PM","Boat on the sea"],
    ["evening-dining","7.36.48 PM","An evening meal"],
    ["evening-outing","7.38.52 PM","An evening outing"],
    ["evening-promenade","7.39.27 PM","A promenade in the evening"],
    ["transfer-car","7.39.27 PM (1)","Owner-supplied transfer car"],
    ["transfer-cabin","7.39.28 PM","Interior of the transfer car"],
    ["transfer-interior","7.39.29 PM","Interior of the transfer car"]
  ].map(([key,time,caption])=>({key,source:`WhatsApp Unknown 2026-10-24 at 1.19.31 AM/WhatsApp Image 2026-10-21 at ${time}.jpeg`,caption}))
];
const manifest=[];
for(const selection of selections){
  const bytes=await readFile(resolve("media",selection.source));
  const {data,info}=await sharp(bytes,{limitInputPixels:40000000}).rotate().resize({width:1440,height:1200,fit:"inside",withoutEnlargement:true}).webp({quality:82,effort:6}).toBuffer({resolveWithObject:true});
  await writeFile(resolve(directory,`${selection.key}.webp`),data);
  const responsive=[];
  for(const width of [480,960,1440]){
    const derivative=await sharp(bytes,{limitInputPixels:40000000}).rotate().resize({width,withoutEnlargement:true}).webp({quality:78,effort:6}).toBuffer();
    await writeFile(resolve(directory,`${selection.key}-${width}.webp`),derivative);
    responsive.push({width,bytes:derivative.length,sha256:createHash("sha256").update(derivative).digest("hex")});
  }
  manifest.push({...selection,sourceSha256:createHash("sha256").update(bytes).digest("hex"),derivativeSha256:createHash("sha256").update(data).digest("hex"),bytes:info.size,width:info.width,height:info.height,responsive,exifRemoved:true,ownerAssetUseAuthorizedOn:selection.source.startsWith("WhatsApp")?"2026-10-24":"2026-10-20",subjectConsentEvidence:"not supplied",productionPublicationApproved:false,servingScope:"loopback-local-preview"});
}
await writeFile(resolve(directory,"owner-media-manifest.json"),JSON.stringify(manifest,null,2));
console.log(JSON.stringify(manifest.map(({key,bytes,width,height})=>({key,bytes,width,height}))));
