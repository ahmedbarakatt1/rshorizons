import {test,expect} from "@playwright/test";
import {randomUUID} from "node:crypto";
import {mkdir} from "node:fs/promises";
import {spawnSync} from "node:child_process";
import pg from "pg";

test("an owner publishes a trip photo and a signed-out guest sees the processed image alongside the existing collection",async({page,browser,baseURL},info)=>{
 test.skip(info.project.name!=="chromium"||process.env.E2E_LOCAL_STAFF!=="1","Uses isolated local staff and storage.");
 test.setTimeout(150000);
 const url=new URL(baseURL!),dbUrl=new URL(process.env.MIGRATION_DATABASE_URL!);
 expect(["127.0.0.1","localhost"]).toContain(url.hostname);
 expect(["127.0.0.1","localhost"]).toContain(dbUrl.hostname);
 const email=`trip-gallery-${randomUUID()}@example.invalid`,password=`Local-${randomUUID()}`,caption=`Desert landscape · ${randomUUID().slice(0,8)}`;
 const provision=spawnSync(process.execPath,["--import","tsx","scripts/provision-admin.ts","--local"],{input:JSON.stringify({email,password,name:"Isolated gallery test owner"}),encoding:"utf8",windowsHide:true});
 expect(provision.status,provision.stderr).toBe(0);
 const db=new pg.Client({connectionString:dbUrl.toString()});await db.connect();
 const guest=await browser.newContext({baseURL});
 try{
  await page.goto("/admin/galleries");
  await page.getByLabel("Email",{exact:true}).fill(email);
  await page.getByLabel("Password",{exact:true}).fill(password);
  await page.getByRole("button",{name:"Sign in",exact:true}).click();
  await page.getByText("Add a trip photo",{exact:true}).click();
  await page.getByLabel("Trip photo",{exact:true}).setInputFiles("public/images/web/desert-480.webp");
  await page.getByLabel("Photo caption",{exact:true}).fill(caption);
  await page.getByLabel("Private source rights reference").fill("Isolated browser fixture");
  await page.getByLabel("Retention review after (days)").fill("1");
  await page.getByLabel("Does the photo show identifiable people?").selectOption("no");
  await page.getByLabel("I verified the source rights",{exact:false}).check();
  await page.getByRole("button",{name:"Publish trip photo"}).click();
  await expect(page.getByText("Photo published.",{exact:false})).toBeVisible({timeout:30000});
  const publicPage=await guest.newPage();
  await publicPage.goto("/ar/gallery");
  const image=publicPage.getByRole("img",{name:caption});
  await image.scrollIntoViewIfNeeded();
  await expect.poll(()=>image.evaluate((node:HTMLImageElement)=>node.complete&&node.naturalWidth>0)).toBe(true);
  await expect(publicPage.locator(".owner-video-section")).toBeVisible();
  const asset=await db.query(`SELECT a.id,ga.public_derivative_id FROM app.media_assets a JOIN app.gallery_assets ga ON ga.asset_id=a.id
    JOIN app.galleries g ON g.id=ga.gallery_id WHERE g.title=$1`,[caption]);
  const source=await guest.request.get(`/api/v1/galleries/public/assets/${asset.rows[0].id}`);
  expect(source.status()).toBe(404);
  const derivative=await guest.request.get(`/api/v1/galleries/public/assets/${asset.rows[0].public_derivative_id}`);
  expect(derivative.headers()["content-type"]).toBe("image/webp");
  await mkdir(".local/evidence/ui/owner-trip-upload",{recursive:true});
  await image.locator("..").screenshot({path:".local/evidence/ui/owner-trip-upload/public-photo.png"});
  await page.locator(".trip-photo-upload").screenshot({path:".local/evidence/ui/owner-trip-upload/owner-result.png"});
 }finally{
  await db.query("UPDATE app.galleries SET visibility_state='revoked' WHERE title=$1",[caption]);
  await db.query("UPDATE app.staff_profiles SET active=false WHERE id IN(SELECT id FROM auth.users WHERE email=$1)",[email]);
  await guest.close();await db.end();
 }
});

test("the gallery keeps earlier photos when a later page needs a retry",async({page})=>{
 const cursor=randomUUID(),caption=(n:number)=>`Gallery page fixture ${n}`;
 const item=(n:number)=>({id:randomUUID(),title:caption(n),trip_photo:true,caption_locale:"en",assets:[{id:randomUUID(),url:"/images/web/desert-480.webp",width:480,height:360}]});
 const firstPage=Array.from({length:50},(_,index)=>item(index+1));
 let attempts=0;
 await page.route("**/api/v1/galleries/public?**",route=>{
  if(new URL(route.request().url()).searchParams.get("cursor")!==cursor)
   return route.fulfill({json:{data:{items:firstPage,nextCursor:cursor}}});
  attempts++;
  if(attempts===1)return route.fulfill({status:503,json:{error:{code:"TEMPORARY",message:"Fixture service unavailable"}}});
  return route.fulfill({json:{data:{items:[item(51)],nextCursor:null}}});
 });
 await page.goto("/en/gallery");
 await expect(page.getByRole("img",{name:caption(50),exact:true})).toBeVisible();
 await page.getByRole("button",{name:"Show more photos and galleries"}).click();
 await expect(page.getByRole("alert").filter({hasText:"Something went wrong"})).toBeVisible();
 await expect(page.getByRole("img",{name:caption(1),exact:true})).toBeAttached();
 await page.getByRole("button",{name:"Try again",exact:true}).click();
 await expect(page.getByRole("img",{name:caption(51),exact:true})).toBeVisible();
 await expect(page.getByRole("img",{name:/^Gallery page fixture /})).toHaveCount(51);
 await expect(page.getByRole("button",{name:"Show more photos and galleries"})).toHaveCount(0);
});
