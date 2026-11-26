import {test, expect} from "@playwright/test";

const activities = ["snorkeling", "diving", "boat-trips", "beach-buggy"] as const;

for (const locale of ["en", "ar"]) {
  for (const activity of activities) {
    test(`@public-release ${locale} opens the priced ${activity} offer from home`, async ({page}) => {
      await page.setViewportSize(locale === "ar" ? {width:390,height:844} : {width:1440,height:900});
      await page.goto(`/${locale}`);
      const main = page.getByRole("main");
      const link = main.locator(`a[href="/${locale}/${activity}"]`).filter({has:page.getByRole("heading")});
      const label = (await link.innerText()).trim();
      await link.click();
      await expect(main.getByRole("heading", {level:1})).toHaveText(label);
      const offer = main.locator(".catalog-card").first();
      const title = await offer.getByRole("heading").innerText();
      const price = await offer.locator(".money").innerText();
      expect(price).toMatch(/\p{Number}/u);
      await offer.getByRole("link").click();
      await expect(main.getByRole("heading", {level:1})).toHaveText(title);
      await expect(main.locator(".detail-price")).toHaveText(price);
      await main.locator('a[href*="/booking/request?service="]').click();
      await expect(main.getByRole("heading", {name:title,exact:true})).toBeVisible();
      await expect(main.locator(".detail-price")).toHaveText(price);
      await expect(main.locator('input[name="name"]')).toBeVisible();
      await expect(page.locator('a[href*="/apartments"], a[href*="/photography"], a[href*="apartment="]')).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    });
  }
}
