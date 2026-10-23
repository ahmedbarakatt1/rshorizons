import {test,expect} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {mkdirSync} from "node:fs";

test("illustrative images fill catalog gaps while actual trip photographs remain separate",async({page},info)=>{
 test.skip(info.project.name!=="chromium","Image content inspection runs in Chromium; responsive behavior has a separate three-engine suite.");
 mkdirSync(".local/evidence/ui",{recursive:true});
 await page.setViewportSize({width:1440,height:1000});
 await page.goto("/en");
 await expect(page.getByRole("heading",{level:1})).toBeVisible();
 const artwork=page.locator(".illustrative-photo");
 await expect(artwork).toHaveCount(3);
 await expect(page.locator(".hero-primary img")).toHaveAttribute("src","/api/v1/demo-media/hero");
 for(const photo of await artwork.all()){
  await photo.scrollIntoViewIfNeeded();
  await expect(photo.locator(".illustrative-photo-caption")).toHaveText("Illustrative image");
  await expect(photo.locator("img")).toHaveAttribute("srcset",/480w.*960w.*1440w/);
  expect(await photo.locator("img").evaluate((image:HTMLImageElement)=>image.decode().then(()=>image.naturalWidth))).toBeGreaterThan(0);
  expect(await photo.locator("img").evaluate((image:HTMLImageElement)=>image.currentSrc)).toMatch(/\.avif$/);
  expect((await photo.boundingBox())?.height).toBeGreaterThan(150);
 }
 await page.screenshot({path:".local/evidence/ui/editorial-home-desktop.png",fullPage:true,animations:"disabled"});
 await page.locator(".featured-experiences").screenshot({path:".local/evidence/ui/editorial-experiences.png",animations:"disabled"});
 for(const [path,subjects] of [["experiences",["buggy","desert"]],["destinations",["coast"]]] as const){
  await page.goto(`/en/${path}`);
  for(const subject of subjects){
   const image=page.locator(`img[src*="/${subject}-v1-"]`).first();
   await expect(image).toBeVisible();await image.scrollIntoViewIfNeeded();
   expect(await image.evaluate((node:HTMLImageElement)=>node.decode().then(()=>node.naturalWidth))).toBeGreaterThan(0);
  }
 }
 await page.goto("/en/apartments");
 await expect(page.locator(".catalog-card .illustrative-photo")).toHaveCount(3);
 await expect(page.locator(".catalog-card img").first()).toHaveAttribute("alt",/^Illustrative image/);
 const result=await new AxeBuilder({page}).withTags(["wcag2a","wcag2aa"]).analyze();
 expect(result.violations).toEqual([]);
 await page.locator(".catalog-card img").first().evaluate((image:HTMLImageElement)=>image.decode());
 await page.screenshot({path:".local/evidence/ui/editorial-apartments-desktop.png",fullPage:true});
 await page.setViewportSize({width:390,height:844});
 await page.goto("/ar/apartments");
 await expect(page.locator(".illustrative-photo-caption").first()).toHaveText("صورة توضيحية");
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await page.locator(".catalog-card img").first().evaluate((image:HTMLImageElement)=>image.decode());
 await page.screenshot({path:".local/evidence/ui/editorial-apartments-arabic-mobile.png",fullPage:true});
 await page.goto("/en/gallery");
 await expect(page.locator(".owner-photo-gallery img")).toHaveCount(12);
 await expect(page.locator(".illustrative-photo")).toHaveCount(0);
});
