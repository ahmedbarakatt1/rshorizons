import {test,expect} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {mkdirSync} from "node:fs";

test("web-sourced catalog photos fill gaps while owner trip photographs remain separate",async({page},info)=>{
 test.skip(info.project.name!=="chromium","Image content inspection runs in Chromium; responsive behavior has a separate three-engine suite.");
 mkdirSync(".local/evidence/ui",{recursive:true});
 await page.setViewportSize({width:1440,height:1000});
 await page.goto("/en");
 await expect(page.getByRole("heading",{level:1})).toBeVisible();
 await expect(page.locator(".hero-primary img")).toHaveAttribute("src","/api/v1/demo-media/hero");
 const webPhotos=page.locator('img[src*="/images/web/"]');
 expect(await webPhotos.count()).toBeGreaterThanOrEqual(2);
 await expect(page.locator(".illustrative-photo")).toHaveCount(0);
 for(const photo of await webPhotos.all()){
  await photo.scrollIntoViewIfNeeded();
  await expect(photo).toHaveAttribute("srcset",/480w.*960w.*1280w/);
  expect(await photo.evaluate((image:HTMLImageElement)=>image.decode().then(()=>image.naturalWidth))).toBeGreaterThan(0);
  expect(await photo.evaluate((image:HTMLImageElement)=>image.currentSrc)).toMatch(/\.webp$/);
  expect((await photo.boundingBox())?.height).toBeGreaterThan(150);
 }
 await page.screenshot({path:".local/evidence/ui/editorial-home-desktop.png",fullPage:true,animations:"disabled"});
 await page.locator(".featured-experiences").screenshot({path:".local/evidence/ui/editorial-experiences.png",animations:"disabled"});
 for(const [path,subjects] of [["experiences",["buggy","desert"]],["destinations",["luxor"]]] as const){
  await page.goto(`/en/${path}`);
  for(const subject of subjects){
   const image=page.locator(`img[src*="/${subject}-960.webp"]`).first();
   await expect(image).toBeVisible();await image.scrollIntoViewIfNeeded();
   expect(await image.evaluate((node:HTMLImageElement)=>node.decode().then(()=>node.naturalWidth))).toBeGreaterThan(0);
  }
 }
 await page.goto("/en/apartments");
 await expect(page.locator('.catalog-card img[src*="/images/web/apartment-"]')).toHaveCount(3);
 await expect(page.locator(".catalog-card img").first()).not.toHaveAttribute("alt",/^Illustrative image/);
 const result=await new AxeBuilder({page}).withTags(["wcag2a","wcag2aa"]).analyze();
 expect(result.violations).toEqual([]);
 await page.locator(".catalog-card img").first().evaluate((image:HTMLImageElement)=>image.decode());
 await page.screenshot({path:".local/evidence/ui/editorial-apartments-desktop.png",fullPage:true});
 await page.setViewportSize({width:390,height:844});
 await page.goto("/ar/apartments");
 await expect(page.locator(".illustrative-photo-caption")).toHaveCount(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await page.locator(".catalog-card img").first().evaluate((image:HTMLImageElement)=>image.decode());
 await page.screenshot({path:".local/evidence/ui/editorial-apartments-arabic-mobile.png",fullPage:true});
 await page.goto("/en/gallery");
 await expect(page.locator(".owner-photo-gallery img")).toHaveCount(12);
 await expect(page.locator(".illustrative-photo")).toHaveCount(0);
});
