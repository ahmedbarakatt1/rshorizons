import {test,expect} from "@playwright/test";
import {readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {randomUUID} from "node:crypto";
import {admin,makeBooking,makeDeparture,tourItem} from "../database/helpers";

test("@public-release team WhatsApp contacts are correct on desktop and Arabic mobile",async({page},info)=>{
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

test("authorized staff can prepare a consenting historical guest draft and follow a manual-contact queue item",async({page},info)=>{
  test.skip(info.project.name!=="chromium"||process.env.E2E_LOCAL_STAFF!=="1","Authenticated local fixture runs once.");
  const db=admin();
  await db.connect();
  let bookingId:string, reference:string;
  try {
    const departure=await makeDeparture(db,8);
    const {booking}=await makeBooking(db,[await tourItem(db,departure.id)]);
    bookingId=booking.id;
    reference=booking.reference;
    const guest=await db.query("UPDATE app.guests SET email=NULL,phone_e164='+201000000001' WHERE id=(SELECT primary_guest_id FROM app.bookings WHERE id=$1) RETURNING id",[bookingId]);
    await db.query("INSERT INTO app.guest_consents(guest_id,type,granted,policy_version,collection_source) VALUES($1,'whatsapp_booking',true,'test','test')",[guest.rows[0].id]);
    // Historical queue entries remain actionable after automated email was retired.
    const event=await db.query("INSERT INTO app.outbox_events(aggregate_type,aggregate_id,aggregate_version,event_type,event_key) VALUES('booking',$1,1,'booking_changed',$2) RETURNING id",[bookingId,randomUUID()]);
    const job=await db.query("INSERT INTO app.jobs(event_id,kind,job_key) VALUES($1,'notification',$2) RETURNING id",[event.rows[0].id,randomUUID()]);
    await db.query("INSERT INTO app.notification_deliveries(job_id,channel,attempt,provider,status,error_class) VALUES($1,'email',1,'internal','suppressed','MANUAL_CONTACT_REQUIRED')",[job.rows[0].id]);
  } finally { await db.end(); }
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
  await page.goto("/admin/notifications");
  const manual=page.locator(".admin-table tbody tr").filter({hasText:reference}).filter({has:page.getByRole("cell",{name:"booking changed",exact:true})}).filter({hasText:"Manual contact required"});
  await expect(manual).toContainText("booking changed");await expect(manual).toContainText("suppressed");
  await expect(manual.getByRole("link",{name:reference})).toHaveAttribute("href",`/admin/bookings/${bookingId}`);
  await page.screenshot({path:".local/evidence/ui/whatsapp-manual-contact-queue.png"});
  await manual.getByRole("link",{name:reference}).click();await expect(page.getByRole("button",{name:"Prepare WhatsApp message",exact:true})).toBeVisible();
});
