import {test, expect} from "@playwright/test";

test("ten locale navigation and private access boundary", async ({page}) => {
  for (const locale of ["en","de","pl","fr","ru","uk","es","ar","it","nl"]) {
    await page.goto(`/${locale}`);
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await expect(page.getByRole("main").getByRole("heading", {level:1})).toBeVisible();
  }
  await page.goto("/en/booking/TR-NOT-AN-ACCESS-CREDENTIAL");
  await expect(page.getByText("Secure booking access")).toBeVisible();
});

test("arabic_form_keyboard_flow", async ({page}) => {
  await page.setViewportSize({width:390,height:844});
  await page.goto("/ar/contact");
  await expect(page.locator("html")).toHaveAttribute("dir","rtl");
  await expect(page.locator("input[type=email]")).toHaveAttribute("dir","ltr");
  await page.getByLabel("الاسم الكامل").fill("اختبار محلي");
  await page.keyboard.press("Tab");
  await expect(page.locator("input[type=email]")).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("request_does_not_confirm and checkout_no_threejs", async ({page}) => {
  const scripts: string[] = [];
  page.on("request", request => { if (request.resourceType() === "script") scripts.push(request.url()); });
  await page.goto("/en/experiences");
  await page.locator(".catalog-card a").first().click();
  await page.getByRole("link",{name:"Request this experience"}).click();
  await expect(page.locator(".approval-notice").getByText("No payment is requested before staff approval.", {exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Calculate my quote"}).click();
  await expect(page.getByRole("heading",{name:"Your quote"})).toBeVisible();
  await page.getByLabel("Full name",{exact:true}).fill("Local UI Test");
  await page.getByLabel("Email",{exact:true}).fill("local-ui@example.test");
  await page.getByLabel("Participant 1").fill("Local UI Test");
  await page.getByLabel("I accept the terms").check();
  await page.getByLabel("I have read the privacy notice").check();
  await page.getByRole("button",{name:"Send reservation request"}).click();
  await expect(page.getByText("Your reservation request has been received and is awaiting staff approval. It is not confirmed yet.")).toBeVisible();
  await expect(page.getByRole("button",{name:/pay now|checkout/i})).toHaveCount(0);
  expect(scripts.some(url => /three|camera-island/i.test(url))).toBe(false);
});
