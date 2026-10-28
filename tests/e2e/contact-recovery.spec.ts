import {test,expect} from "@playwright/test";
import {readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import pg from "pg";
import {deliverNotification} from "../../src/integrations/messaging/notifications";

test.use({trace:"off"}); // One-time links remain private, including on failed assertions.
test("guest contact reaches the staff inbox and resolves without changing the message",async({page},info)=>{
 test.skip(info.project.name!=="chromium"||process.env.E2E_LOCAL_STAFF!=="1","Authenticated local fixture runs once.");
 const rateDb=new pg.Client({connectionString:process.env.MIGRATION_DATABASE_URL});await rateDb.connect();
 try{await rateDb.query("DELETE FROM app.rate_limit_buckets WHERE operation='contact'");}finally{await rateDb.end();}
 const name=`Synthetic contact ${Date.now()}`,message="Please confirm accessible pickup for our group.";
 await page.goto("/en/contact");await page.getByLabel("Full name",{exact:true}).fill(name);await page.getByLabel("Email",{exact:true}).fill("contact-browser@example.invalid");await page.getByLabel("Message",{exact:true}).fill(message);await page.locator('form.contact-form input[type="checkbox"]').check();
 const submitted=page.waitForResponse(response=>response.url().endsWith("/api/v1/contact")&&response.request().method()==="POST");
 await page.getByRole("button",{name:"Send message",exact:true}).click();expect((await submitted).status()).toBe(202);await expect(page.getByRole("status")).toContainText("Your message has been received.");
 const bootstrap=spawnSync(process.execPath,["scripts/bootstrap-local-operator.mjs"],{encoding:"utf8",env:process.env,windowsHide:true});expect(bootstrap.status,bootstrap.stderr).toBe(0);
 const grant=JSON.parse(readFileSync(".local/operator-access.json","utf8"));
 await page.goto("/admin/contact");await page.getByText("Local operator access",{exact:true}).click();await page.getByLabel("Local operator token").fill(grant.token);await page.getByRole("button",{name:"Open local workspace"}).click();
 await page.getByRole("link",{name,exact:true}).click();await expect(page.getByText(message,{exact:true})).toBeVisible();
 await page.getByRole("combobox",{name:"Contact status",exact:true}).selectOption("closed");await page.getByRole("button",{name:"Save status",exact:true}).click();await expect(page.getByRole("status")).toContainText("Contact status updated.");
 await page.reload();await expect(page.getByRole("combobox",{name:"Contact status",exact:true})).toHaveValue("closed");await expect(page.getByText(message,{exact:true})).toBeVisible();
 await page.screenshot({path:".local/evidence/ui/contact-inbox-desktop.png",fullPage:true});await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:".local/evidence/ui/contact-inbox-mobile.png",fullPage:true});
 await page.getByRole("link",{name:"Back to contact inbox",exact:true}).click();await expect(page.locator("tbody tr").filter({hasText:name})).toContainText("closed");
 const db=new pg.Client({connectionString:process.env.MIGRATION_DATABASE_URL});await db.connect();const prefix=`Synthetic older ${Date.now()}`;
 const inserted=await db.query(`INSERT INTO app.contact_requests(sender_name,email,locale,message,consent_metadata,created_at,retention_deadline)
  SELECT $1::text||' '||n,'older@example.invalid','en','Please arrange pickup.','{}',now()-make_interval(secs=>n),now()+interval '90 days' FROM generate_series(1,55) n RETURNING id`,[prefix]);
 try{
  await page.getByRole("combobox",{name:"Request status",exact:true}).selectOption("new");
  await expect(page.getByRole("link",{name:`${prefix} 55`,exact:true})).toHaveCount(0);
  await page.getByRole("button",{name:"Load older requests",exact:true}).click();await expect(page.getByRole("link",{name:`${prefix} 55`,exact:true})).toBeVisible();
  await page.screenshot({path:".local/evidence/ui/contact-inbox-pagination.png",fullPage:true});
 }finally{await db.query("DELETE FROM app.contact_requests WHERE id=ANY($1::uuid[])",[inserted.rows.map(row=>row.id)]);await db.end();}
});

test("guest recovers a lost booking link and deliberately redeems the local email preview",async({page,context},info)=>{
 test.skip(info.project.name!=="chromium"||process.env.E2E_LOCAL_STAFF!=="1","Isolated local notification fixture runs once.");
 const db=new pg.Client({connectionString:process.env.MIGRATION_DATABASE_URL});await db.connect();
 const previous={APP_ENV:process.env.APP_ENV,EMAIL_PROVIDER:process.env.EMAIL_PROVIDER};process.env.APP_ENV="test";process.env.EMAIL_PROVIDER="local";
 try{
  await db.query("DELETE FROM app.rate_limit_buckets WHERE operation='guest-access'");
  const seed=spawnSync(process.execPath,["scripts/seed-local-notifications.mjs"],{encoding:"utf8",env:process.env,windowsHide:true});expect(seed.status,seed.stderr).toBe(0);
  await page.goto("/en/experiences/boat-tours");await page.getByRole("link",{name:"Request this experience",exact:true}).click();await page.getByRole("button",{name:"Calculate my quote",exact:true}).click();
  await page.getByLabel("Full name",{exact:true}).fill("Synthetic recovery guest");await page.getByLabel("Email",{exact:true}).fill("recovery-browser@example.invalid");await page.getByLabel("Participant 1",{exact:true}).fill("Synthetic recovery guest");await page.getByLabel("I accept the terms").check();await page.getByLabel("I have read the privacy notice").check();
  const created=page.waitForResponse(r=>r.url().endsWith("/api/v1/bookings")&&r.request().method()==="POST");await page.getByRole("button",{name:"Send reservation request",exact:true}).click();const response=await created;expect(response.status()).toBe(201);const {reference}= (await response.json()).data;
  await context.clearCookies();await page.goto("/en/my-booking");await page.getByLabel("Booking reference",{exact:true}).fill(reference);await page.locator('input[name="contact"]').fill("recovery-browser@example.invalid");
  const requested=page.waitForResponse(r=>r.url().endsWith("/guest-access/request"));await page.getByRole("button",{name:"Send access link",exact:true}).click();expect((await requested).status()).toBe(202);
  const event=(await db.query("SELECT e.id,e.event_type,e.aggregate_id,e.payload FROM app.outbox_events e JOIN app.bookings b ON b.id=e.aggregate_id WHERE b.reference=$1 AND e.event_type='guest_access_requested'",[reference])).rows[0];
  const job=(await db.query("UPDATE app.jobs SET status='running',attempts=1,lease_until=now()+interval '2 minutes' WHERE event_id=$1 RETURNING id,attempts",[event.id])).rows[0];
  await deliverNotification({...job,event});
  const delivery=(await db.query("SELECT provider_message_id FROM app.notification_deliveries WHERE job_id=$1 AND status='accepted'",[job.id])).rows[0];
  const preview=JSON.parse(readFileSync(`.local/outbox/${delivery.provider_message_id.slice(6)}.json`,"utf8"));const match=preview.text.match(/https?:\/\/[^\s]+/);if(!match)throw new Error("Local preview did not contain access URL");
  const usedBefore=(await db.query("SELECT count(*)::int n FROM app.access_grants WHERE booking_id=$1 AND used_at IS NOT NULL",[event.aggregate_id])).rows[0].n;
  await page.goto(match[0]);await expect(page.getByRole("button",{name:"Open secure access",exact:true})).toBeVisible();
  expect((await db.query("SELECT count(*)::int n FROM app.access_grants WHERE booking_id=$1 AND used_at IS NOT NULL",[event.aggregate_id])).rows[0].n).toBe(usedBefore);
  await expect(page.locator('input[name="token"]')).not.toHaveValue("");
  const redeemed=page.waitForResponse(r=>r.url().endsWith("/guest-access/redeem"));
  await page.getByRole("button",{name:"Open secure access",exact:true}).click();expect((await redeemed).status()).toBe(200);await expect(page).toHaveURL(new RegExp(`/en/booking/${reference}$`));await expect(page.locator(".status-heading bdi")).toHaveText(reference);
  expect((await db.query("SELECT count(*)::int n FROM app.access_grants WHERE booking_id=$1 AND used_at IS NOT NULL",[event.aggregate_id])).rows[0].n).toBe(usedBefore+1);
  await page.screenshot({path:".local/evidence/ui/recovered-booking.png",fullPage:true});
 }finally{for(const [key,value] of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}await db.end();}
});
