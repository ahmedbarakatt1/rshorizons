import {test,expect} from "@playwright/test";
import {readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import pg from "pg";

test.use({trace:"off"}); // One-time links remain private, including on failed assertions.
test("staff can resolve a saved contact request and page through older messages",async({page},info)=>{
 test.skip(info.project.name!=="chromium"||process.env.E2E_LOCAL_STAFF!=="1","Authenticated local fixture runs once.");
 const dbFixture=new pg.Client({connectionString:process.env.MIGRATION_DATABASE_URL});
 const name=`Synthetic contact ${Date.now()}`,message="Please confirm accessible pickup for our group.";
 await dbFixture.connect();
 try {
   await dbFixture.query(`INSERT INTO app.contact_requests(sender_name,email,locale,message,consent_metadata,retention_deadline)
      VALUES($1,'contact-browser@example.invalid','en',$2,'{}',now()+interval '1 day')`,[name,message]);
 } finally {await dbFixture.end();}
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

test("a guest who needs booking help can contact either number directly", async({page})=>{
  await page.goto("/en/my-booking");
  const contacts=page.locator('main a[href^="https://wa.me/"]');
  await expect(contacts).toHaveCount(2);
  await expect(page.locator('main a[href="mailto:horizonsredsea@gmail.com"]')).toBeVisible();
  await expect(page.getByRole("button",{name:"Send access link"})).toHaveCount(0);
  await expect(page.getByRole("button",{name:"Open secure access"})).toBeVisible();
});
