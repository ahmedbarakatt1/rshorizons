import {test,expect} from "@playwright/test";

test("@a11y responsive reading, image loading and keyboard navigation",async({page,context})=>{
  // Each viewport is an independent visit. Repeated full-document navigation
  // aborts Next prefetch requests in WebKit and contaminates the next viewport.
  for(const width of [360,768,1440,1920]){
    const viewportPage=await context.newPage(),errors:string[]=[];
    viewportPage.on("pageerror",error=>errors.push(error.message));
    await viewportPage.setViewportSize({width,height:1000});
    await viewportPage.goto("/en");
    await expect(viewportPage.getByRole("heading",{level:1})).toBeVisible();
    await viewportPage.locator(".hero-primary img").evaluate((image:HTMLImageElement)=>image.decode());
    expect(await viewportPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await viewportPage.keyboard.press("Tab");
    await expect(viewportPage.getByRole("link",{name:"Skip to main content"})).toBeFocused();
    await viewportPage.keyboard.press("Enter");
    await expect(viewportPage.locator("#main")).toBeFocused();
    expect(errors).toEqual([]);
    await viewportPage.close();
  }
  const errors:string[]=[];
  page.on("pageerror",error=>errors.push(error.message));
  await page.goto("/en/gallery");
  await expect(page.locator(".owner-photo-gallery img")).toHaveCount(12);
  for(const image of await page.locator(".owner-photo-gallery img").all()){
    await image.scrollIntoViewIfNeeded();
    await image.evaluate((node:HTMLImageElement)=>node.decode());
    await expect(image).toHaveAttribute("alt",/\S/);
  }
  expect(errors).toEqual([]);
});

test("@a11y private fragments require deliberate redemption and leave the address bar",async({page})=>{
  let redemptions=0;
  page.on("request",request=>{if(request.url().includes("/guest-access/redeem"))redemptions++;});
  await page.goto("/en/my-booking#token=synthetic-invalid-test-token");
  await expect(page.getByLabel("Access token")).toHaveValue("synthetic-invalid-test-token");
  expect(new URL(page.url()).hash).toBe("");
  expect(redemptions).toBe(0);
  await page.getByRole("button",{name:"Open secure access"}).click();
  await expect(page.getByRole("status")).toBeVisible();
  expect(redemptions).toBe(1);
});
