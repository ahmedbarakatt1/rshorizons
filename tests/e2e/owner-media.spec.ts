import {test,expect} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {mkdirSync} from "node:fs";

test("owner photos and videos load on demand, play and seek",async({page},info)=>{
 const videoRequests:string[]=[];page.on("request",request=>{if(request.url().endsWith(".mp4"))videoRequests.push(request.url());});
 await page.goto("/en/gallery");
 await expect(page.locator(".trip-video")).toHaveCount(6);
 await expect(page.locator(".owner-photo-gallery img")).toHaveCount(12);
 const first=page.locator(".trip-video").first();
 await first.scrollIntoViewIfNeeded();
 expect(videoRequests).toEqual([]);
 await first.getByRole("button",{name:/Play video/}).click();
 const video=first.locator("video");await expect(video).toHaveAttribute("controls","");
 await video.evaluate(async(element:HTMLVideoElement)=>{await element.play();});
 await expect.poll(()=>video.evaluate((element:HTMLVideoElement)=>element.currentTime)).toBeGreaterThan(0.1);
 const duration=await video.evaluate((element:HTMLVideoElement)=>element.duration);
 expect(duration).toBeGreaterThan(0.5);
 await video.evaluate((element:HTMLVideoElement)=>{element.pause();element.currentTime=element.duration/2;});
 await expect.poll(()=>video.evaluate((element:HTMLVideoElement)=>element.seeking)).toBe(false);
 expect(await video.evaluate((element:HTMLVideoElement)=>element.error)).toBeNull();
 await page.getByRole("button",{name:/Show more videos/}).click();
 await expect(page.locator(".trip-video")).toHaveCount(12);
 await expect(page.locator(".trip-video video")).toHaveCount(1);
 if(info.project.name==="chromium"){
  const result=await new AxeBuilder({page}).withTags(["wcag2a","wcag2aa"]).analyze();expect(result.violations).toEqual([]);
  mkdirSync(".local/evidence/ui",{recursive:true});
  await page.locator(".owner-video-section").screenshot({path:".local/evidence/ui/owner-videos-desktop.png"});
 }
 for(let batch=0;batch<3;batch++)await page.getByRole("button",{name:/Show more videos/}).click();
 await expect(page.locator(".trip-video")).toHaveCount(30);
 await expect(page.getByRole("button",{name:/Show more videos/})).toHaveCount(0);
 expect(videoRequests.every(url=>url.endsWith("/clip-gx019474.mp4"))).toBe(true);
 await page.goto("/en/experiences/transportation");
 await expect(page.locator(".detail-hero img, img.detail-hero")).toHaveAttribute("src","/api/v1/demo-media/transfer-car");
 await page.goto("/ar/gallery");await page.setViewportSize({width:390,height:844});
 await expect(page.locator(".trip-video")).toHaveCount(6);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 if(info.project.name==="chromium")await page.screenshot({path:".local/evidence/ui/owner-gallery-arabic.png",fullPage:true});
});
