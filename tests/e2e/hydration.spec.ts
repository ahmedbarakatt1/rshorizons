import {expect, test} from "@playwright/test";

test("language selection and private form submission wait for their interactive handlers", async ({page}) => {
  const detail = await page.request.get("/en/experiences/transportation");
  const bookingPath = (await detail.text()).match(/href="([^"]*\/booking\/request\?service=[^"]+)"/)?.[1];
  expect(bookingPath).toBeTruthy();

  let resume!: () => void;
  const gate = new Promise<void>(resolve => { resume = resolve; });
  await page.route("**/_next/static/**", async route => {
    if (route.request().resourceType() === "script") await gate;
    await route.continue();
  });
  try {
    await page.goto(bookingPath!, {waitUntil:"commit"});
    await expect(page.locator(".locale-control select")).toBeDisabled();
    await expect(page.locator(".whatsapp-booking button[type=submit]")).toBeDisabled();
  } finally {
    resume();
  }
  await expect(page.locator(".whatsapp-booking button[type=submit]")).toBeEnabled();
  for (const locale of ["de","pl"]) {
    await page.locator(".locale-control select").selectOption(locale);
    await expect(page).toHaveURL(new URL(bookingPath!.replace("/en/", `/${locale}/`), page.url()).href);
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
  }
});

test("guest access and review forms keep private inputs out of native GET submissions", async ({browser,baseURL}) => {
  const context = await browser.newContext({baseURL,javaScriptEnabled:false});
  try {
    const page = await context.newPage();
    for (const [path,selector] of [["/en/guest-access",".review-access-form"],["/en/reviews",".review-submit"]]) {
      await page.goto(path);
      const form = page.locator(selector);
      await expect(form).toHaveAttribute("method","post");
      await expect(form.getByRole("button")).toBeDisabled();
    }
  } finally {
    await context.close();
  }
});
