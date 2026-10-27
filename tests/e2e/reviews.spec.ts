import {test,expect} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const review={id:"60000000-0000-4000-8000-000000000001",rating:2,text:"Synthetic review fixture: the pickup was late. The reef was beautiful.",locale:"en",display_name:"J. S.",submitted_at:"2026-10-20T10:00:00Z",replies:[{body:"Synthetic staff reply: thank you for sharing your experience.",publishedAt:"2026-10-21T10:00:00Z"}]};
const summary={total:13,average:4.2,ratings:{1:0,2:1,3:0,4:7,5:5}};

test("reviews show original feedback, honest aggregate, rating filters and another page",async({page})=>{
 await page.route("**/api/v1/reviews?**",async route=>{
  const url=new URL(route.request().url());
  const filtered=url.searchParams.get("rating")==="2";
  const more=url.searchParams.has("cursor");
  await route.fulfill({json:{data:{items:more?[{...review,id:"60000000-0000-4000-8000-000000000002",text:"Synthetic review fixture: a second page."}]:[review],summary,filteredTotal:filtered?1:13,nextCursor:filtered||more?null:review.id}}});
 });
 await page.goto("/en/reviews");
 await expect(page.getByText(review.text)).toBeVisible();
 await expect(page.getByText(review.replies[0].body)).toBeVisible();
 await expect(page.getByText("13 published reviews",{exact:true})).toBeVisible();
 await page.getByRole("button",{name:"Show more reviews"}).click();
 await expect(page.getByText("Synthetic review fixture: a second page.")).toBeVisible();
 await page.getByLabel("Filter by rating").selectOption("2");
 await expect(page.getByText("Showing 1 of 1 reviews")).toBeVisible();
 await expect(page.getByRole("button",{name:"Show more reviews"})).toHaveCount(0);
 await expect(page.getByText("13 published reviews",{exact:true})).toBeVisible();
});

test("reviews have an honest empty state and a recoverable loading error",async({page})=>{
 let fail=true;
 await page.route("**/api/v1/reviews?**",async route=>{
  if(fail)await route.fulfill({status:503,json:{error:{code:"UNAVAILABLE"}}});
  else await route.fulfill({json:{data:{items:[],summary:{total:0,average:null,ratings:{1:0,2:0,3:0,4:0,5:0}},filteredTotal:0,nextCursor:null}}});
 });
 await page.goto("/en/reviews");
 await expect(page.locator("main").getByRole("alert")).toContainText("Reviews could not be loaded");
 fail=false;await page.getByRole("button",{name:"Try again"}).click();
 await expect(page.getByRole("heading",{name:"Your stories belong here"})).toBeVisible();
 await expect(page.getByText("0.0")).toHaveCount(0);
 await expect(page.getByRole("link",{name:"Explore experiences"})).toBeVisible();
});

test("invited reviewer chooses an accessible rating and public display name and cannot submit twice",async({page})=>{
 await page.route("**/api/v1/reviews**",async route=>{
  if(route.request().method()==="POST"){
   expect(route.request().postDataJSON()).toMatchObject({rating:2,displayName:"anonymous",text:"Synthetic invitation review for browser verification.",invitationId:review.id,locale:"en"});
   await route.fulfill({status:201,json:{data:{id:review.id,state:"pending"}}});
  }else await route.fulfill({json:{data:{items:[],summary:{total:0,average:null,ratings:{1:0,2:0,3:0,4:0,5:0}},filteredTotal:0,nextCursor:null}}});
 });
 await page.goto(`/en/reviews?invitation=${review.id}`);
 await page.getByRole("radio",{name:"2 out of 5 stars",exact:true}).check();
 await page.getByLabel("Your review",{exact:true}).fill("Synthetic invitation review for browser verification.");
 await page.getByLabel("Public display name").selectOption("anonymous");
 await page.getByRole("button",{name:"Submit review"}).click();
 await expect(page.getByRole("status").filter({hasText:"Thank you"})).toBeVisible();
 await expect(page.getByRole("button",{name:"Submit review"})).toHaveCount(0);
 await expect(page.getByText("Your review will appear after moderation.")).toBeVisible();
});

test("a visitor can enter a secure review code directly on the reviews page",async({page})=>{
 await page.route("**/api/v1/reviews?**",route=>route.fulfill({json:{data:{items:[],summary:{total:0,average:null,ratings:{1:0,2:0,3:0,4:0,5:0}},filteredTotal:0,nextCursor:null}}}));
 await page.goto("/en/reviews");
 await page.getByRole("link",{name:"Share your experience"}).click();
 await expect(page.getByLabel("Access token")).toBeVisible();
 await expect(page.getByRole("button",{name:"Open secure access"})).toBeVisible();
});

test("@a11y reviews remain readable and accessible on mobile and Arabic RTL",async({page},info)=>{
 await page.route("**/api/v1/reviews?**",route=>route.fulfill({json:{data:{items:[review],summary:{total:1,average:2,ratings:{1:0,2:1,3:0,4:0,5:0}},filteredTotal:1,nextCursor:null}}}));
 await page.setViewportSize({width:390,height:844});
 for(const locale of ["en","ar"]){
  await page.goto(`/${locale}/reviews?invitation=${review.id}`);
  await expect(page.getByText(review.text)).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("dir",locale==="ar"?"rtl":"ltr");
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const scan=await new AxeBuilder({page}).withTags(["wcag2a","wcag2aa","wcag21aa","wcag22aa"]).analyze();
  expect(scan.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}))).toEqual([]);
  if(info.project.name==="chromium")await page.screenshot({path:`.local/evidence/ui/reviews-${locale}-mobile.png`,fullPage:true,animations:"disabled"});
 }
 if(info.project.name==="chromium"){
  await page.setViewportSize({width:1440,height:1000});await page.goto("/en/reviews");await expect(page.getByText(review.text)).toBeVisible();
  await page.screenshot({path:".local/evidence/ui/reviews-desktop.png",fullPage:true,animations:"disabled"});
 }
});

test("reviews are discoverable in navigation and long display names wrap on narrow screens",async({page})=>{
 await page.route("**/api/v1/reviews?**",route=>route.fulfill({json:{data:{items:[{...review,display_name:"SyntheticGuestName".repeat(6).slice(0,100)}],summary:{total:1,average:2,ratings:{1:0,2:1,3:0,4:0,5:0}},filteredTotal:1,nextCursor:null}}}));
 await page.goto("/en/reviews");
 await expect(page.locator(".desktop-nav").getByRole("link",{name:"Guest reviews"})).toBeVisible();
 await page.setViewportSize({width:390,height:844});
 await expect(page.getByText(review.text)).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.locator(".mobile-menu summary").click();
 await expect(page.locator(".mobile-menu").getByRole("link",{name:"Guest reviews"})).toBeVisible();
});
