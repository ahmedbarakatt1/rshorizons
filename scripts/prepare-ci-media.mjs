import sharp from "sharp";
import {mkdir,writeFile,readFile} from "node:fs/promises";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
if(process.env.CI!=="true"||process.env.APP_ENV!=="test"||process.env.DEMO_MODE!=="true")throw new Error("Synthetic media is restricted to explicit CI test mode.");
await mkdir(".local/media",{recursive:true});
const svg=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="#065966"/><text x="80" y="400" font-size="48" fill="white">Synthetic CI image fixture</text></svg>');
const bytes=await sharp(svg).webp({quality:80}).toBuffer();
const photos=JSON.parse(await readFile("src/content/owner-photos.json","utf8")),videos=JSON.parse(await readFile("src/content/owner-videos.json","utf8"));
for(const name of ["hero","diving","reef",...photos.map(photo=>photo.key)])for(const suffix of ["","-480","-960","-1440"])await writeFile(`.local/media/${name}${suffix}.webp`,bytes);
await promisify(execFile)("ffmpeg",["-v","error","-f","lavfi","-i","color=c=navy:s=320x240:d=1","-an","-c:v","libx264","-pix_fmt","yuv420p","-movflags","+faststart","-y",".local/media/ci-synthetic.mp4"],{windowsHide:true,timeout:20000});
const clip=await readFile(".local/media/ci-synthetic.mp4");
for(const video of videos){await writeFile(`.local/media/${video.key}.mp4`,clip);await writeFile(`.local/media/${video.key}-poster.webp`,bytes);}
console.log("Generated explicitly synthetic CI media; no owner originals are checked into source.");
