import {mkdirSync,readFileSync,writeFileSync,copyFileSync,existsSync} from "node:fs";
import {createHash} from "node:crypto";
import sharp from "sharp";

// Source paths are private workstation state; provenance and optimized outputs are committed.
const sources=JSON.parse(readFileSync(".local/editorial-generation.json","utf8"));
const allowed=new Set(["desert","apartment","buggy","boat","coast","transfer"]);
mkdirSync(".local/editorial-originals",{recursive:true});
mkdirSync("public/images/editorial",{recursive:true});
const evidence=[];
for(const {key,source} of sources){
 if(!allowed.has(key))throw new Error("Unknown editorial subject");
 const original=readFileSync(source);
 const hash=createHash("sha256").update(original).digest("hex");
 const archive=`.local/editorial-originals/${key}-v1.png`;
 if(existsSync(archive)&&createHash("sha256").update(readFileSync(archive)).digest("hex")!==hash)throw new Error("Use a new version for changed originals");
 copyFileSync(source,archive);
 const variants=[];
 for(const width of [480,960,1440])for(const format of ["webp","avif"]){
  const path=`public/images/editorial/${key}-v1-${width}.${format}`;
  const pipeline=sharp(original).rotate().resize({width,withoutEnlargement:true});
  await (format==="avif"?pipeline.avif({quality:38,effort:6}):pipeline.webp({quality:76,effort:5})).toFile(path);
  const bytes=readFileSync(path);
  variants.push({path,width,format,bytes:bytes.length,sha256:createHash("sha256").update(bytes).digest("hex")});
 }
 evidence.push({key,originalSha256:hash,variants});
}
writeFileSync("docs/evidence/editorial-media.json",JSON.stringify({generatedWith:"built-in image_gen",images:evidence},null,2)+"\n");
console.log(`Prepared ${evidence.length} illustrative images in three sizes with AVIF/WebP; originals preserved privately.`);
