import sharp from "sharp";
import {mkdir,writeFile} from "node:fs/promises";
if(process.env.CI!=="true"||process.env.APP_ENV!=="test"||process.env.DEMO_MODE!=="true")throw new Error("Synthetic media is restricted to explicit CI test mode.");
await mkdir(".local/media",{recursive:true});
const svg=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="#065966"/><text x="80" y="400" font-size="48" fill="white">Synthetic CI image fixture</text></svg>');
const bytes=await sharp(svg).webp({quality:80}).toBuffer();
for(const name of ["hero","diving","reef","surface-swim","reef-pause","underwater-heart","open-water"])for(const suffix of ["","-480","-960","-1440"])await writeFile(`.local/media/${name}${suffix}.webp`,bytes);
console.log("Generated explicitly synthetic CI media; no owner originals are checked into source.");
