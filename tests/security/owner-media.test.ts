import {afterEach,describe,expect,it,vi} from "vitest";
import {mkdtemp,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,resolve,sep} from "node:path";
import {serveOwnerMedia} from "@/integrations/storage/owner-media";

afterEach(()=>vi.unstubAllEnvs());
describe("owner preview media boundary and seeking",()=>{
 it("never serves originals, unlisted keys, remote hosts or production requests",async()=>{
  vi.stubEnv("APP_ENV","test");vi.stubEnv("DEMO_MODE","true");
  for(const [host,key] of [["example.org","clip-gx019474.mp4"],["localhost","../source.MP4"],["localhost","unknown"],["localhost","clip-unknown.mp4"]]){
   await expect(serveOwnerMedia(new Request(`http://${host}/`),key)).rejects.toMatchObject({status:404});
  }
  vi.stubEnv("APP_ENV","production");
  await expect(serveOwnerMedia(new Request("http://localhost/"),"hero")).rejects.toMatchObject({status:404});
 });
 it("streams only the requested byte range, including suffix and open-ended requests",async()=>{
  vi.stubEnv("APP_ENV","test");vi.stubEnv("DEMO_MODE","true");
  const directory=await mkdtemp(join(tmpdir(),"rsh-media-test-"));
  try{
   await writeFile(join(directory,"clip-gx019474.mp4"),Buffer.from("0123456789"));
   for(const [range,expected,contentRange] of [["bytes=2-5","2345","bytes 2-5/10"],["bytes=-3","789","bytes 7-9/10"],["bytes=8-","89","bytes 8-9/10"],["bytes=8-100","89","bytes 8-9/10"]]){
    const response=await serveOwnerMedia(new Request("http://localhost/",{headers:{Range:range}}),"clip-gx019474.mp4",directory);
    expect(response.status).toBe(206);expect(await response.text()).toBe(expected);
    expect(response.headers.get("Content-Range")).toBe(contentRange);
    expect(response.headers.get("Content-Type")).toBe("video/mp4");
    expect(response.headers.get("Cache-Control")).toContain("private");
   }
   for(const range of ["bytes=10-","bytes=5-3","bytes=-0","bytes=0-1,4-5","bytes=abc"]){
    const response=await serveOwnerMedia(new Request("http://localhost/",{headers:{Range:range}}),"clip-gx019474.mp4",directory);
    expect(response.status).toBe(416);expect(response.headers.get("Content-Range")).toBe("bytes */10");
    expect(await response.text()).toBe("");
   }
   const head=await serveOwnerMedia(new Request("http://localhost/",{method:"HEAD"}),"clip-gx019474.mp4",directory);
   expect(head.status).toBe(200);expect(head.headers.get("Content-Length")).toBe("10");expect(await head.text()).toBe("");
   await expect(serveOwnerMedia(new Request("http://localhost/"),"hero",directory)).rejects.toMatchObject({status:404});
  }finally{if(resolve(directory).startsWith(resolve(tmpdir())+sep+"rsh-media-test-"))await rm(directory,{recursive:true,force:true});}
 });
});
