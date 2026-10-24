import {test,expect} from "@playwright/test";
import {mkdirSync} from "node:fs";

test("staff upload sends a file above 4.5 MB directly to storage before server finalization",async({page},info)=>{
 const galleryId="19c21a99-c871-4e60-b17d-3a78e0273917",assetId="04261499-d02d-4497-9641-80fcc79b2709";
 const uploadUrl=`https://storage-test.supabase.co/storage/v1/object/upload/sign/tourism-private/${assetId}/source.bin?token=synthetic-browser-upload`;
 const bytes=Buffer.alloc(5*1024*1024,7),events:string[]=[];
 await page.route("**/api/v1/admin/**",async route=>{
  const path=new URL(route.request().url()).pathname;
  let data:unknown={};
  if(path.endsWith("/session"))data={permissions:["galleries.manage","media.upload"]};
  else if(path.endsWith("/galleries"))data={items:[{id:galleryId,title:"Synthetic storage transport",kind:"public",visibility_state:"draft",version:1}]};
  else if(path.endsWith("/upload-intents")){
   events.push("intent");expect(route.request().postDataJSON()).toMatchObject({galleryId,sizeBytes:bytes.length,mimeType:"video/mp4"});
   data={assetId,uploadUrl,method:"PUT",state:"quarantine"};
  }else if(path.endsWith(`/${assetId}/complete`)){events.push("finalize");data={assetId,state:"processing"};}
  else if(path.endsWith("/bytes"))throw new Error("The file must not pass through the Vercel request body");
  await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({data,meta:{requestId:"synthetic"}})});
 });
 await page.route("https://storage-test.supabase.co/**",async route=>{
  if(route.request().method()==="OPTIONS")return route.fulfill({status:204,headers:{"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"PUT","Access-Control-Allow-Headers":"content-type"}});
  events.push("storage");expect(route.request().method()).toBe("PUT");
  expect(route.request().postDataBuffer()?.length).toBe(bytes.length);
  expect(route.request().headers().cookie).toBeUndefined();expect(route.request().headers().authorization).toBeUndefined();
  await route.fulfill({status:200,contentType:"application/json",body:"{}",headers:{"Access-Control-Allow-Origin":"*"}});
 });
 await page.goto("/admin/galleries");
 await page.getByRole("button",{name:"Manage",exact:true}).click();
 await page.getByLabel("Photo or video",{exact:true}).setInputFiles({name:"synthetic-large-video.mp4",mimeType:"video/mp4",buffer:bytes});
 await page.getByRole("button",{name:"Upload for processing",exact:true}).click();
 await expect(page.getByRole("status")).toHaveText("Upload accepted for processing. It is not published.");
 expect(events).toEqual(["intent","storage","finalize"]);
 mkdirSync(".local/evidence/ui",{recursive:true});
 await page.screenshot({path:`.local/evidence/ui/hosted-media-upload-${info.project.name}.png`,fullPage:true});
});
