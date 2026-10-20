import {describe,expect,it} from "vitest";
import {validateUploadBytes,MAX_IMAGE_BYTES} from "@/modules/photography/validation";
import {createHash} from "node:crypto";
import sharp from "sharp";

describe("quarantined uploads",()=>{
  it("rejects executable bytes with a claimed image MIME",async()=>{
    const bytes=Buffer.from("<script>alert('x')</script>");
    await expect(validateUploadBytes(bytes,{mimeType:"image/png",sizeBytes:bytes.length,checksumSha256:createHash("sha256").update(bytes).digest("hex")})).rejects.toThrow("MEDIA_TYPE_MISMATCH");
  });
  it("rejects size and checksum spoofing before processing",async()=>{
    const bytes=await sharp({create:{width:4,height:4,channels:3,background:"#146e80"}}).png().toBuffer();
    const declared={mimeType:"image/png" as const,sizeBytes:bytes.length,checksumSha256:createHash("sha256").update(bytes).digest("hex")};
    await expect(validateUploadBytes(bytes,{...declared,sizeBytes:MAX_IMAGE_BYTES+1})).rejects.toThrow("MEDIA_SIZE_INVALID");
    await expect(validateUploadBytes(bytes,{...declared,checksumSha256:"0".repeat(64)})).rejects.toThrow("MEDIA_CHECKSUM_MISMATCH");
  });
  it("requires complete image decoding and returns stripped previews",async()=>{
    const bytes=await sharp({create:{width:4,height:4,channels:3,background:"#146e80"}}).jpeg().withMetadata({exif:{IFD0:{Artist:"PRIVATE"}}}).toBuffer();
    const result=await validateUploadBytes(bytes,{mimeType:"image/jpeg",sizeBytes:bytes.length,checksumSha256:createHash("sha256").update(bytes).digest("hex")});
    expect(result.kind).toBe("image");
    if(result.kind==="image") expect((await sharp(result.preview).metadata()).exif).toBeUndefined();
    await expect(validateUploadBytes(bytes.subarray(0,40),{mimeType:"image/jpeg",sizeBytes:40,checksumSha256:createHash("sha256").update(bytes.subarray(0,40)).digest("hex")})).rejects.toThrow();
  });
});
