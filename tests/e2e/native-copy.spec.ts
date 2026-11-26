import {expect, test} from "@playwright/test";
import {readFileSync} from "node:fs";
import {locales} from "../../src/i18n/locales";

test("@public-release trip details read naturally in each guest language",async({page})=>{
  test.setTimeout(120000);
  for(const locale of locales){
    const messages=JSON.parse(readFileSync(`messages/${locale}.json`,"utf8"));
    await page.goto(`/${locale}/experiences/boat-tours`);
    const main=page.getByRole("main");
    await expect(main.getByRole("heading",{level:1})).toBeVisible();
    await expect(main).not.toContainText("operatorApprovalRequired");
    await expect(main).not.toContainText("Development preview");
    await expect(page.locator(".footer-bottom")).toContainText(messages.regionName);
    await expect(main.getByText(messages.clearanceRequired,{exact:true})).toBeVisible();
    await expect(main.locator('a[href*="/booking/request?service="]')).toBeVisible();
  }
});
