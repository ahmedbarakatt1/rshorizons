import {expect, test, type Page} from "@playwright/test";

async function expectCairo(page: Page, selectors: string[]) {
  for (const selector of selectors) {
    const element = page.locator(selector).first();
    await expect(element).toBeVisible();
    const family = await element.evaluate(node => getComputedStyle(node).fontFamily.split(",")[0].trim());
    expect(family.replace(/["']/g, ""), selector).toBe("Cairo");
  }
  const faces = await page.evaluate(async () => {
    await document.fonts.ready;
    return Array.from(document.fonts)
      .filter(face => face.family.replace(/["']/g, "") === "Cairo" && face.status === "loaded")
      .map(face => face.unicodeRange.toUpperCase());
  });
  // Both Arabic letters and the Latin digits used in prices and telephone numbers.
  expect(faces.some(range => range.includes("600-6FF"))).toBe(true);
  expect(faces.some(range => range.includes("0-FF"))).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

for (const width of [390, 1366]) {
  test(`Arabic guest and staff typography at ${width}px`, async ({page}) => {
    await page.setViewportSize({width, height: 844});
    const fontRequests: URL[] = [];
    page.on("request", request => {
      if (request.resourceType() === "font") fontRequests.push(new URL(request.url()));
    });

    await page.goto("/ar");
    await expectCairo(page, ["body", "main h1", "main p", ".locale-control select"]);
    await page.goto("/admin?lang=ar");
    await expectCairo(page, [".admin-login", ".admin-login h1", ".admin-login p", "input[name=email]", ".admin-login button"]);

    await page.route("**/api/v1/admin/session", route => route.fulfill({json: {data: {permissions: ["bookings.read"]}}}));
    await page.route("**/api/v1/admin/summary", route => route.fulfill({json: {data: {pendingRequests: 2, activeHolds: 0, confirmedBookings: 1, openExceptions: 0}}}));
    await page.route("**/api/v1/admin/bookings?status=pending_review", route => route.fulfill({json: {data: {items: []}}}));
    await page.goto("/admin?lang=ar");
    await expectCairo(page, [".admin-sheet", ".admin-sheet h1", ".admin-kpis dd"]);
    expect(fontRequests.length).toBeGreaterThan(0);
    expect(fontRequests.every(url => url.origin === new URL(page.url()).origin)).toBe(true);
  });
}

test("English guest and staff pages use their existing typography", async ({page}) => {
  for (const path of ["/en", "/admin"]) {
    await page.goto(path);
    const heading = page.locator("main h1").first();
    await expect(heading).toBeVisible();
    await expect(heading).toHaveCSS("font-family", /Georgia/);
    const loaded = await page.evaluate(async () => {
      await document.fonts.ready;
      return Array.from(document.fonts).some(face => face.family.includes("Cairo") && face.status === "loaded");
    });
    expect(loaded).toBe(false);
  }
});
