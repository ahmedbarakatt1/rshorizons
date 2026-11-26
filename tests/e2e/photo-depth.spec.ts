import {expect, test} from "@playwright/test";

for (const [locale, width] of [["en", 1440], ["ar", 390]] as const) {
  test(`@public-release ${locale} trip subjects extend past their photo frames`, async ({page}) => {
    await page.setViewportSize({width, height: 900});
    await page.emulateMedia({reducedMotion: "reduce"});
    await page.goto(`/${locale}`);

    const photos = [
      {selector: ".hero-primary img", subject: [.78, .075], outside: [.62, .075]},
      {selector: '.activity-grid img[src$="/boat-day"]', subject: [.82, .33], outside: [.82, .21]},
    ];
    for (const {selector, subject, outside} of photos) {
      const photo = page.locator(selector);
      await expect(photo).toHaveCount(1);
      const visibleAt = await photo.evaluate(async (image: HTMLImageElement, points) => {
        const frame = image.closest(".trip-photo-cutout") ?? image;
        frame.scrollIntoView({block: "center", behavior: "instant"});
        await image.decode();
        const {left, top, width, height} = frame.getBoundingClientRect();
        return points.map(([x, y]) => document.elementFromPoint(left + x * width, top + y * height) === image);
      }, [subject, outside]);
      expect(visibleAt).toEqual([true, false]);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
