import {test,expect} from "@playwright/test";
import {readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {randomUUID} from "node:crypto";
import pg from "pg";

test("team WhatsApp contacts are correct on desktop and Arabic mobile",async({page},info)=>{
  for(const locale of ["en","ar"]){
    if(locale==="ar")await page.setViewportSize({width:390,height:844});
    await page.goto(`/${locale}/contact`);
    const links=page.locator('main .whatsapp-contact-links a');await expect(links).toHaveCount(2);
    for(const [index,number] of ["201099267451","201220907478"].entries()){
      const url=new URL((await links.nth(index).getAttribute("href"))!);
      expect(url.origin+url.pathname).toBe(`https://wa.me/${number}`);expect(url.searchParams.get("text")).toBeTruthy();
      await expect(links.nth(index)).toHaveAttribute("target","_blank");await expect(links.nth(index)).toHaveAttribute("rel","noopener noreferrer");
    }
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:`.local/evidence/ui/whatsapp-contact-${locale}-${info.project.name}.png`,fullPage:true});
  }
});

test("a reservation gives guest-to-team and authorized staff-to-guest drafts without sending",async({page},info)=>{
  test.skip(info.project.name!=="chromium"||process.env.E2E_LOCAL_STAFF!=="1","Authenticated local fixture runs once.");
  await page.goto("/en/experiences/boat-tours");await page.getByRole("link",{name:"Request this experience",exact:true}).click();
  await page.getByRole("button",{name:"Calculate my quote",exact:true}).click();
  await page.getByLabel("Full name",{exact:true}).fill("Synthetic WhatsApp link guest");
  await page.getByLabel("Email",{exact:true}).fill("whatsapp-link@example.invalid");
  await page.locator('input[name="phoneE164"]').fill("+201000000001");
  await page.getByLabel("Participant 1",{exact:true}).fill("Synthetic WhatsApp link guest");
  await page.getByLabel("I accept the terms").check();await page.getByLabel("I have read the privacy notice").check();await page.locator('input[name="whatsapp"]').check();
  const created=page.waitForResponse(response=>response.url().endsWith("/api/v1/bookings")&&response.request().method()==="POST");
  await page.getByRole("button",{name:"Send reservation request",exact:true}).click();
  const response=await created;expect(response.status()).toBe(201);const reference=(await response.json()).data.reference;
  const teamLink=page.locator('.receipt-panel a[href^="https://wa.me/"]').first();await expect(teamLink).toBeVisible();
  expect(new URL((await teamLink.getAttribute("href"))!).searchParams.get("text")).toContain(reference);
  await page.screenshot({path:".local/evidence/ui/whatsapp-booking-receipt.png",fullPage:true});
  const bootstrap=spawnSync(process.execPath,["scripts/bootstrap-local-operator.mjs"],{encoding:"utf8",env:{...process.env,APP_ENV:"development",DEMO_MODE:"true"},windowsHide:true});
  expect(bootstrap.status,bootstrap.stderr).toBe(0);
  const grant=JSON.parse(readFileSync(".local/operator-access.json","utf8")) as {token:string};
  await page.goto("/admin");await page.getByText("Local operator access",{exact:true}).click();await page.getByLabel("Local operator token").fill(grant.token);await page.getByRole("button",{name:"Open local workspace"}).click();
  await expect(page.getByRole("heading",{name:"Reservation overview"})).toBeVisible();
  await page.goto("/admin/bookings");await page.locator(".admin-table tbody tr").filter({hasText:reference}).getByRole("link").click();
  await page.getByRole("button",{name:"Prepare WhatsApp message",exact:true}).click();
  const link=page.getByRole("link",{name:"Open WhatsApp draft",exact:true});await expect(link).toBeVisible();
  const url=new URL((await link.getAttribute("href"))!);expect(url.origin+url.pathname).toBe("https://wa.me/201000000001");expect(url.searchParams.get("text")).toContain(reference);expect(url.href).not.toContain("token");
  await expect(page.locator(".admin-title-row .status")).toHaveText("pending review");
  await page.screenshot({path:".local/evidence/ui/whatsapp-admin-draft.png",fullPage:true});
  // Existing phone-only bookings still need an actionable staff queue when an event occurs.
  const bookingId=new URL(page.url()).pathname.split("/").at(-1)!;
  const db=new pg.Client({connectionString:process.env.MIGRATION_DATABASE_URL});await db.connect();
  try{
    await db.query("UPDATE app.guests SET email=NULL WHERE id=(SELECT primary_guest_id FROM app.bookings WHERE id=$1)",[bookingId]);
    const event=(await db.query("INSERT INTO app.outbox_events(aggregate_type,aggregate_id,aggregate_version,event_type,event_key) VALUES('booking',$1,1,'booking_changed',$2) RETURNING id",[bookingId,randomUUID()])).rows[0];
    await db.query("INSERT INTO app.jobs(event_id,kind,job_key) VALUES($1,'notification',$2)",[event.id,randomUUID()]);
    const dispatch=spawnSync(process.execPath,["--import","tsx","scripts/run-worker.ts","50"],{encoding:"utf8",env:{...process.env,APP_ENV:"development",DEMO_MODE:"true",EMAIL_PROVIDER:"local",VIDEO_PROVIDER:"local",PAYMOB_MODE:"local",WHATSAPP_PROVIDER:"links"},windowsHide:true});
    expect(dispatch.status,dispatch.stderr).toBe(0);
  }finally{await db.end();}
  await page.goto("/admin/notifications");
  const manual=page.locator(".admin-table tbody tr").filter({hasText:reference}).filter({has:page.getByRole("cell",{name:"booking changed",exact:true})}).filter({hasText:"Manual contact required"});
  await expect(manual).toContainText("booking changed");await expect(manual).toContainText("suppressed");
  await expect(manual.getByRole("link",{name:reference})).toHaveAttribute("href",`/admin/bookings/${bookingId}`);
  await page.screenshot({path:".local/evidence/ui/whatsapp-manual-contact-queue.png"});
  await manual.getByRole("link",{name:reference}).click();await expect(page.getByRole("button",{name:"Prepare WhatsApp message",exact:true})).toBeVisible();
});
