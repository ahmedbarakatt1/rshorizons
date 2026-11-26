import {expect, test} from "@playwright/test";

for (const [locale, width] of [["en", 1440], ["ar", 390]] as const) {
  test(`@public-release ${locale} shows the full-width branded Red Sea relief banner, trip photos and raised boat`, async ({page}) => {
    await page.setViewportSize({width, height: 900});
    await page.emulateMedia({reducedMotion: "reduce"});
    await page.goto(`/${locale}`);

    const diver = page.locator(".hero-primary img");
    await diver.scrollIntoViewIfNeeded();
    const corners = await diver.evaluate(async (image: HTMLImageElement) => {
      await image.decode();
      const {left, right, top, bottom} = image.getBoundingClientRect();
      return [[left + 2, top + 2], [right - 2, top + 2], [left + 2, bottom - 2], [right - 2, bottom - 2]]
        .map(([x, y]) => document.elementFromPoint(x, y) === image);
    });
    expect(corners).toEqual([true, true, true, true]);

    const banner = page.locator(".home-hero");
    const edges = await banner.evaluate(el => [el.getBoundingClientRect().left, el.getBoundingClientRect().right, document.documentElement.clientWidth]);
    expect(edges[0]).toBe(0);
    expect(edges[1]).toBe(edges[2]);
    await expect(banner.getByRole("heading", {level: 1})).toBeVisible();
    await expect(banner.locator('img[src*="horizons-wave"]')).toBeVisible();
    const map = banner.locator('img[src*="red-sea-relief"]');
    await expect(map).toHaveAccessibleName(/\S/);
    expect(await map.evaluate(async (img: HTMLImageElement) => {await img.decode(); return img.naturalWidth;})).toBeGreaterThan(400);
    await expect(banner.locator('a[href$="/gallery"]')).toBeVisible();
    await expect(page.getByTestId("nautical-compass")).toHaveCount(0);

    const boat = page.locator('.activity-grid img[src$="/boat-day"]');
    const boatPixels = await boat.evaluate(async (image: HTMLImageElement) => {
      const frame = image.closest(".trip-photo-cutout") ?? image;
      frame.scrollIntoView({block: "center", behavior: "instant"});
      await image.decode();
      const {left, top, width, height} = frame.getBoundingClientRect();
      return [.33, .21].map(y => document.elementFromPoint(left + .82 * width, top + y * height) === image);
    });
    expect(boatPixels).toEqual([true, false]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
