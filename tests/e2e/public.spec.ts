import {test, expect} from "@playwright/test";

test("@public-release ten languages load and preserve the selected route when switching language", async ({page}) => {
  await page.goto("/en/boat-trips");
  for (const locale of ["de","pl","fr","ru","uk","es","ar","it","nl","en"]) {
    await page.locator("header select").selectOption(locale);
    await expect(page).toHaveURL(new RegExp(`/${locale}/boat-trips$`));
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await expect(page.locator("html")).toHaveAttribute("dir",locale === "ar" ? "rtl" : "ltr");
    await expect(page.getByRole("main").getByRole("heading", {level:1})).toBeVisible();
    await expect(page.locator(".catalog-card .money").first()).toContainText(/\p{Number}/u);
  }
});

for (const locale of ["en","ar"]) {
  test(`@public-release ${locale} payment and contact destinations are owner-approved`, async ({page}) => {
    await page.setViewportSize(locale === "ar" ? {width:390,height:844} : {width:1440,height:900});
    await page.goto(`/${locale}/payment-options`);
    const main = page.getByRole("main"), methods = main.locator(".payment-methods");
    await expect(methods).toContainText("abdohassan8123@instapay");
    await expect(methods).toContainText("01201338200");
    await expect(methods).toContainText(locale === "ar" ? "اطلب بيانات الحساب من خدمة العملاء" : "Ask customer service for the account details");
    await expect(methods).toContainText(locale === "ar" ? "قبل تحويل أي أموال" : "before transferring money");
    await expect(methods.getByRole("link")).toHaveAttribute("href","https://ipn.eg/S/abdohassan8123/instapay/8Yhxaj");
    await page.goto(`/${locale}/contact`);
    for (const href of ["mailto:horizonsredsea@gmail.com","tel:+201099267451","tel:+201220907478","https://www.facebook.com/share/1CFka6exsG/","https://www.instagram.com/horizonsrs2026/","https://www.tiktok.com/@red.sea.horizons"]) {
      await expect(main.locator(`a[href="${href}"]`)).toHaveAccessibleName(/\S/);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });

  test(`@public-release ${locale} retired sales and booking links are unavailable`, async ({page}) => {
    for (const path of ["apartments","apartments/demo-1","photography","experiences/photography","booking/request?service=photography","booking/request?apartment=demo-1"]) {
      const response = await page.goto(`/${locale}/${path}`);
      expect(response?.status(), path).toBe(404);
      await expect(page.getByRole("heading", {name:"404",exact:true}), path).toBeVisible();
      await expect(page.locator('main .catalog-card, main input[name="name"], main a[href*="/booking/request"]')).toHaveCount(0);
    }
  });
}

test("@public-release a reservation reference alone displays only customer service", async ({page}) => {
  await page.goto("/en/booking/TR-NOT-AN-ACCESS-CREDENTIAL");
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", {level:1})).toHaveText("Customer service");
  await expect(main.locator('a[href^="https://wa.me/"]')).toHaveCount(2);
  await expect(main.locator(".status-heading, .quote-panel, .receipt-panel")).toHaveCount(0);
});

test("@public-release the home search keeps the chosen activity and a catalog refresh uses the same filter", async ({page}) => {
  await page.goto("/en");
  const search = page.locator("form.discovery-search");
  await search.locator('select[name="category"]').selectOption("beach-buggy");
  await search.locator('input[name="guests"]').fill("2");
  await search.getByRole("button").click();
  await expect(page).toHaveURL(/\/en\/experiences\?/);
  const filter = page.locator(".catalog-filters");
  await expect(filter.locator('[name="category"]')).toHaveValue("beach_buggy");
  await expect(filter.locator('[name="guests"]')).toHaveValue("2");
  const results = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === "/api/v1/services" && url.searchParams.get("category") === "beach_buggy";
  });
  await filter.getByRole("button").click();
  const response = await results;
  expect(response.ok()).toBe(true);
  const payload = await response.json() as {data:{items:{category:string;slug:string}[]}};
  const items = payload.data.items;
  expect(items.length).toBeGreaterThan(0);
  expect(items.every(item => item.category === "beach_buggy")).toBe(true);
  const cards = page.locator(".catalog-card a");
  await expect(cards).toHaveCount(items.length);
  const hrefs = await cards.evaluateAll(links => links.map(link => link.getAttribute("href")));
  expect(hrefs.sort()).toEqual(items.map(item => `/en/experiences/${item.slug}`).sort());
});

test.describe("mobile touch navigation", () => {
  test.use({viewport:{width:390,height:844},hasTouch:true,deviceScaleFactor:2});
  test("@public-release Arabic guests can tap the mobile menu, close it by keyboard and reach reviews", async ({page}) => {
    await page.goto("/ar");
    const menu = page.locator("header .mobile-menu");
    const toggle = menu.locator("summary");
    await toggle.tap();
    const reviews = menu.locator('a[href="/ar/reviews"]');
    await expect(reviews).toBeVisible();
    await reviews.focus();
    await reviews.press("Escape");
    await expect(toggle).toBeFocused();
    await expect(reviews).toBeHidden();
    await toggle.tap();
    await reviews.tap();
    await expect(page).toHaveURL(/\/ar\/reviews$/);
    await expect(page.getByRole("main").getByRole("heading", {level:1})).toBeVisible();
    await expect(menu.locator("nav")).toBeHidden();
  });
});
