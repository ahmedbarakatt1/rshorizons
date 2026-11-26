import {test, expect} from "@playwright/test";

const cases = [
  {locale:"en", mobile:false, payment:"instapay", phone:"+201099267451"},
  {locale:"ar", mobile:true, payment:"wallet", phone:"+201220907478"},
  {locale:"en", mobile:true, payment:"bank", phone:"+201220907478"},
  {locale:"ar", mobile:false, payment:"discuss", phone:"+201099267451"},
] as const;

for (const {locale,mobile,payment,phone} of cases) {
  test(`@public-release ${locale} ${mobile ? "mobile" : "desktop"} prepares and edits a ${payment} WhatsApp draft`, async ({page}) => {
    const mutations: string[] = [], externalChats: string[] = [], scriptUrls: string[] = [];
    await page.route("**/api/v1/**", async route => {
      const request = route.request();
      if (["GET","HEAD","OPTIONS"].includes(request.method())) return route.continue();
      mutations.push(request.method() + " " + new URL(request.url()).pathname);
      await route.abort();
    });
    await page.route("https://wa.me/**", async route => {
      externalChats.push(route.request().url());
      await route.abort();
    });
    page.on("request", request => {
      if (request.resourceType() === "script") scriptUrls.push(request.url());
    });
    await page.setViewportSize(mobile ? {width:390,height:844} : {width:1440,height:900});
    await page.goto(`/${locale}/experiences/transportation`);
    const main = page.getByRole("main");
    const service = await main.getByRole("heading", {level:1}).innerText();
    await main.locator('a[href*="/booking/request?service="]').click();
    const form = main.locator("form");
    const name = form.locator('[name="name"]');
    const submit = form.getByRole("button", {name:/./});
    await submit.click();
    await expect(name).toBeFocused();
    const guest = locale === "ar" ? "ضيف للاختبار" : "QA Guest";
    await name.fill(guest);
    await name.press("Tab");
    const date = form.locator('[name="date"]');
    await expect(date).toBeFocused();
    const preferredDate = new Date(Date.now() + 14 * 86400000).toISOString().slice(0,10);
    await date.fill(preferredDate);
    await form.locator('[name="time"]').fill("09:30");
    await form.locator('[name="guests"]').fill("3");
    await form.locator('[name="children"]').fill("2");
    await form.locator('[name="pickup"]').fill("QA airport");
    await form.locator('[name="dropoff"]').fill("QA hotel");
    await form.locator('[name="flight"]').fill("QA123");
    await form.locator('[name="luggage"]').fill("4");
    const preferences = form.locator('select[name="payment"]');
    await preferences.selectOption(payment);
    const paymentLabel = await preferences.locator("option:checked").innerText();
    await form.locator('select[dir="ltr"]').selectOption(phone);
    const notes = "Pickup & luggage + 2 | البحر الأحمر";
    await form.locator('[name="notes"]').fill(notes);
    await submit.click();
    const draft = main.locator(".whatsapp-draft");
    await expect(draft).toBeFocused();
    const editor = draft.getByRole("textbox"), outbound = draft.getByRole("link");
    const message = await editor.inputValue();
    for (const value of [service,guest,preferredDate,"09:30","QA airport","QA hotel","QA123",paymentLabel,notes]) expect(message).toContain(value);
    for (const count of ["3","2","4"]) expect(message).toMatch(new RegExp(": " + count + "$", "m"));
    await expect(draft).toContainText(locale === "ar" ? "لا يؤكد الحجز" : "does not confirm your booking");
    await expect(outbound).toHaveAttribute("target","_blank");
    await expect(outbound).toHaveAttribute("rel",/noopener/);
    await expect(outbound).toHaveAttribute("referrerpolicy","no-referrer");
    const handoff = new URL((await outbound.getAttribute("href"))!);
    expect(handoff.origin + handoff.pathname).toBe(`https://wa.me/${phone.slice(1)}`);
    expect(handoff.searchParams.get("text")).toBe(message);
    await editor.fill(" ");
    await expect(outbound).toHaveCount(0);
    const edited = `${guest} & revised + time?`;
    await editor.fill(edited);
    expect(new URL((await outbound.getAttribute("href"))!).searchParams.get("text")).toBe(edited);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await draft.getByRole("button").click();
    await expect(name).toBeFocused();
    await expect(name).toHaveValue(guest);
    await expect(preferences).toHaveValue(payment);
    expect(mutations).toEqual([]);
    expect(externalChats).toEqual([]);
    expect(scriptUrls.filter(url => /three|camera-island/i.test(url))).toEqual([]);
  });
}
