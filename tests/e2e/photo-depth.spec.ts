import {expect, test} from "@playwright/test";

for (const [locale, width] of [["en", 1440], ["ar", 390]] as const) {
  test(`@public-release ${locale} keeps the full diver photo, a separate compass and the raised boat`, async ({page}) => {
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

    const compass = page.getByTestId("nautical-compass");
    await expect(compass).toBeVisible();
    await expect(compass).toHaveAttribute("aria-hidden", "true");
    const compassBox = await compass.boundingBox();
    const photoBox = await diver.boundingBox();
    expect(compassBox && photoBox && (
      compassBox.x + compassBox.width <= photoBox.x || photoBox.x + photoBox.width <= compassBox.x ||
      compassBox.y + compassBox.height <= photoBox.y || photoBox.y + photoBox.height <= compassBox.y
    )).toBe(true);
    const dial = compass.locator("[data-part=dial]");
    const needle = compass.locator("[data-part=needle]");
    await expect(dial).toBeVisible();
    await expect(needle).toBeVisible();
    expect(await needle.evaluate(element => new DOMMatrix(getComputedStyle(element).transform).m43))
      .toBeGreaterThan(await dial.evaluate(element => new DOMMatrix(getComputedStyle(element).transform).m43));

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
