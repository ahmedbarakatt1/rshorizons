import sharp from "sharp";
import {writeFileSync} from "node:fs";
const svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" rx="8" fill="#faf9f6"/><path d="M3 29c7-16 18-19 26-9-13-4-12 17 14 15-18 13-36 4-32-4-4 0-6 0-8-2Z" fill="#07384c"/><path d="M7 15c11-13 31-6 31 7-6-8-16-10-31-7Z" fill="#15b1bc"/><circle cx="38" cy="12" r="5" fill="#ecc471"/></svg>';
const png=await sharp(Buffer.from(svg)).resize(48,48).png().toBuffer();
const header=Buffer.alloc(22);header.writeUInt16LE(1,2);header.writeUInt16LE(1,4);header[6]=48;header[7]=48;header.writeUInt16LE(1,10);header.writeUInt16LE(32,12);header.writeUInt32LE(png.length,14);header.writeUInt32LE(22,18);
writeFileSync("src/app/favicon.ico",Buffer.concat([header,png]));
