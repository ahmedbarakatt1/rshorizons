import {test, expect} from "@playwright/test";

test("Arabic guests can browse each dedicated activity and see its offers", async ({page}) => {
  await page.goto("/ar");
  for (const slug of ["snorkeling", "diving", "boat-trips", "beach-buggy"]) {
    const link = page.locator(`main a[href="/ar/${slug}"]`).first();
    await expect(link).toBeVisible();
    const title = await link.innerText();
    await link.click();
    await expect(page.locator("h1")).toHaveText(title.trim());
    await expect(page.locator(".catalog-card .money").first()).toBeVisible();
    await expect(page.locator('a[href*="/apartments"], a[href*="/photography"]')).toHaveCount(0);
    await page.locator(".catalog-card a").first().click();
    await page.locator('.request-panel a[href*="/booking/request"]').click();
    await expect(page.locator('input[name="name"]')).toBeVisible();
    await expect(page.locator('.whatsapp-booking select[dir="ltr"]')).toBeVisible();
    await page.goto("/ar");
  }
});
