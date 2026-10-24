import {test,expect} from "@playwright/test";
import {spawnSync} from "node:child_process";
import {randomUUID} from "node:crypto";
import pg from "pg";
import sharp from "sharp";

test("password administrator updates a real quote price and uploads a gallery photo",async({page},info)=>{
  test.skip(info.project.name!=="chromium"||process.env.E2E_LOCAL_STAFF!=="1","Isolated local database fixture.");
  test.setTimeout(90000);
  const email=`admin-${randomUUID()}@example.invalid`,password=`Synthetic-${randomUUID()}`;
  const provision=spawnSync(process.execPath,["--import","tsx","scripts/provision-admin.ts","--local"],{input:JSON.stringify({email,password,name:"Browser test administrator"}),encoding:"utf8",env:process.env,windowsHide:true});
  expect(provision.status,provision.stderr).toBe(0);
  const db=new pg.Client({connectionString:process.env.MIGRATION_DATABASE_URL});await db.connect();
  try{
    await db.query("DELETE FROM app.rate_limit_buckets WHERE operation IN('staff-auth','staff-password')");
    await page.goto("/admin");await page.getByLabel("Email",{exact:true}).fill(email);await page.getByLabel("Password",{exact:true}).fill(password);
    await page.getByRole("button",{name:"Sign in",exact:true}).click();
    await expect(page.getByRole("heading",{name:"Reservation overview"})).toBeVisible();
    await page.screenshot({path:".local/evidence/ui/password-admin-dashboard.png",fullPage:true});
    await page.goto("/admin/content");
    await page.getByRole("button",{name:"Manage",exact:true}).first().click();
    await page.getByText("Variants, rates and payment policies",{exact:true}).click();
    const price=page.getByRole("heading",{name:"Add seasonal price",exact:true}).locator("..");
    const variant=(await db.query("SELECT id FROM app.service_variants WHERE id=md5('variant:boat_tours')::uuid")).rows[0].id;
    await price.getByLabel("Experience variant",{exact:true}).selectOption(variant);
    const departure=(await db.query("SELECT id,starts_at::date::text AS service_date FROM app.departures WHERE variant_id=$1 AND cutoff_at>now() ORDER BY starts_at LIMIT 1",[variant])).rows[0];
    expect(departure).toBeTruthy();
    await price.getByLabel("Guest category",{exact:true}).selectOption("adult");
    await price.getByLabel("Effective from",{exact:true}).fill(departure.service_date);
    const end=new Date(`${departure.service_date}T12:00:00Z`);end.setUTCDate(end.getUTCDate()+1);
    await price.getByLabel("Exclusive end date",{exact:true}).fill(end.toISOString().slice(0,10));
    await price.getByLabel("Amount in minor units",{exact:true}).fill("678900");
    const priority=Number((await db.query("SELECT coalesce(max(priority),0)+1 AS p FROM app.price_rules WHERE variant_id=$1",[variant])).rows[0].p);
    await price.getByLabel("Priority (0–1000)",{exact:true}).fill(String(priority));
    const changed=page.waitForResponse(r=>r.url().endsWith("/api/v1/admin/prices")&&r.request().method()==="POST");
    await price.getByRole("button",{name:"Save",exact:true}).click();expect((await changed).status()).toBe(201);
    const quote=(await db.query("SELECT app.create_quote($1::jsonb) q",[JSON.stringify({bindingHash:randomUUID().replaceAll("-","").repeat(2),locale:"en",paymentPolicy:"arrival",items:[{kind:"tour",variantId:variant,departureId:departure.id,adults:1,children:0}]})])).rows[0].q;
    expect((await db.query("SELECT total::text FROM app.quotes WHERE id=$1",[quote.id])).rows[0].total).toBe("678900");
    await db.query("DELETE FROM app.price_rules WHERE variant_id=$1 AND priority=$2 AND amount=678900",[variant,priority]);
    await page.goto("/admin/galleries");await page.getByRole("button",{name:"Create gallery",exact:true}).click();
    await page.getByLabel("Gallery type",{exact:true}).selectOption("public");
    const title=`Browser photo ${randomUUID()}`;await page.getByLabel("Gallery title",{exact:true}).fill(title);
    await page.getByRole("button",{name:"Save",exact:true}).click();
    const row=page.locator("tbody tr").filter({hasText:title});await row.getByRole("button",{name:"Manage",exact:true}).click();
    const photo=await sharp({create:{width:320,height:240,channels:3,background:"#358a9b"}}).png().toBuffer();
    await page.getByLabel("Photo or video",{exact:true}).setInputFiles({name:"synthetic-admin-photo.png",mimeType:"image/png",buffer:photo});
    const completed=page.waitForResponse(r=>r.url().includes("/admin/media/")&&r.url().endsWith("/complete"));
    await page.getByRole("button",{name:"Upload for processing",exact:true}).click();
    expect((await completed).status()).toBe(200);
    await expect(page.getByRole("status")).toContainText("Upload accepted for processing");
    await page.screenshot({path:".local/evidence/ui/password-admin-photo-upload.png",fullPage:true});
    await page.getByRole("button",{name:"Sign out",exact:true}).click();
    await expect(page.getByRole("heading",{name:"Staff sign in"})).toBeVisible();
  }finally{await db.end();}
});

test("choosing WhatsApp makes the booking phone number required",async({page})=>{
  await page.goto("/en/experiences/boat-tours");await page.getByRole("link",{name:"Request this experience",exact:true}).click();
  await page.getByRole("button",{name:"Calculate my quote",exact:true}).click();
  const phone=page.locator('input[name="phoneE164"]');await expect(phone).toBeVisible();
  expect(await phone.evaluate((node:HTMLInputElement)=>node.required)).toBe(false);
  await page.locator('input[name="whatsapp"]').check();
  expect(await phone.evaluate((node:HTMLInputElement)=>node.required)).toBe(true);
  expect(await phone.evaluate((node:HTMLInputElement)=>node.validity.valueMissing)).toBe(true);
  await phone.fill("+201234567890");expect(await phone.evaluate((node:HTMLInputElement)=>node.checkValidity())).toBe(true);
});
