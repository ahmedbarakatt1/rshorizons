import {test,expect} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {mkdirSync,writeFileSync} from "node:fs";

test("@a11y release pages have no automated WCAG A/AA violations and private responses reject caching",async({page},info)=>{
 test.skip(info.project.name!=="chromium","Structural automated scan runs once; keyboard and locale journeys cover all three engines.");
 const measurements:unknown[]=[];
 for(const path of ["/en","/ar/contact","/en/experiences/boat-tours","/en/booking/request?service=boat-tours"]){
  const response=await page.goto(path);expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading",{level:1})).toBeVisible();
  await expect(page.locator("main[aria-busy=true]")).toHaveCount(0);
  const result=await new AxeBuilder({page}).withTags(["wcag2a","wcag2aa","wcag21aa","wcag22aa"]).analyze();
  expect(result.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>n.target)})),path).toEqual([]);
  measurements.push({path,...await page.evaluate(()=>({navigation:performance.getEntriesByType("navigation").map(e=>({duration:e.duration})),resources:performance.getEntriesByType("resource").filter(e=>(e as PerformanceResourceTiming).initiatorType==="script").map(e=>({name:e.name.split("/").at(-1),bytes:(e as PerformanceResourceTiming).encodedBodySize}))}))});
 }
 const privateResponse=await page.goto("/en/my-booking");
 expect(privateResponse?.headers()["cache-control"]).toContain("no-store");
 expect(privateResponse?.headers()["x-robots-tag"]).toContain("noindex");
 const csp=privateResponse?.headers()["content-security-policy"]??"";
 const scripts=csp.split(";").find(directive=>directive.trim().startsWith("script-src"))??"";
 expect(scripts).toContain("'nonce-");expect(scripts).not.toContain("'unsafe-inline'");
 await page.setViewportSize({width:1440,height:1000});await page.goto("/en");
 await expect(page.getByRole("heading",{level:1})).toBeVisible();
 for(const image of await page.locator("main img").all()){await image.scrollIntoViewIfNeeded();await image.evaluate((node:HTMLImageElement)=>node.decode());}
 await page.evaluate(()=>window.scrollTo({top:0,behavior:"instant"}));
 await page.screenshot({path:".local/evidence/ui/release-public-desktop.png",fullPage:true,animations:"disabled"});
 await page.setViewportSize({width:390,height:844});await page.goto("/en/gallery");
 await expect(page.locator(".editorial-gallery img")).toHaveCount(4);
 for(const image of await page.locator(".editorial-gallery img").all()){await image.scrollIntoViewIfNeeded();await image.evaluate((node:HTMLImageElement)=>node.decode());}
 await page.evaluate(()=>window.scrollTo({top:0,behavior:"instant"}));
 await page.screenshot({path:".local/evidence/ui/release-gallery-mobile.png",fullPage:true});
 await page.goto("/ar/contact");await expect(page.getByRole("heading",{level:1})).toBeVisible();await expect(page.getByRole("button",{name:"أرسل الرسالة"})).toBeEnabled();await page.screenshot({path:".local/evidence/ui/release-arabic-mobile.png",fullPage:true});
 mkdirSync("docs/evidence",{recursive:true});
 writeFileSync("docs/evidence/browser-lab.json",JSON.stringify({at:new Date().toISOString(),environment:"Local production build, Chromium, no CPU/network throttle; lab diagnostics only, not field Core Web Vitals.",measurements},null,2));
});
