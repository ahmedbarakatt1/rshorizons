import {test,expect} from "@playwright/test";

test("Arabic admin workspace keeps navigation and operational data functional",async({page})=>{
  let createdResource:Record<string,unknown>|null=null;
  await page.route("**/api/v1/admin/session",route=>route.fulfill({json:{data:{permissions:["bookings.read","operations.write","contacts.read","finance.reconcile","galleries.manage","catalog.write","notifications.read","reports.read","staff.manage","audit.read","apartments.write"]}}}));
  await page.route("**/api/v1/admin/summary",route=>route.fulfill({json:{data:{pendingRequests:2,activeHolds:1,confirmedBookings:8,openExceptions:0}}}));
  await page.route("**/api/v1/admin/bookings?status=pending_review",route=>route.fulfill({json:{data:{items:[]}}}));
  await page.route("**/api/v1/admin/bookings",route=>route.fulfill({json:{data:{items:[]}}}));
  await page.route("**/api/v1/admin/lookups",route=>route.fulfill({json:{data:{}}}));
  await page.route("**/api/v1/admin/resources",async route=>{
    if(route.request().method()==="POST"){createdResource=route.request().postDataJSON();return route.fulfill({status:201,json:{data:{id:"00000000-0000-4000-8000-000000000001"}}});}
    return route.fulfill({json:{data:{items:[]}}});
  });

  await page.goto("/admin?lang=ar");
  await expect(page.locator(".admin-app")).toHaveAttribute("dir","rtl");
  await expect(page.getByRole("heading",{name:"نظرة عامة على الحجوزات"})).toBeVisible();
  await expect(page.getByRole("navigation",{name:"التنقل في العمليات"})).toBeVisible();
  await expect(page.getByRole("link",{name:"الحجوزات",exact:true})).toBeVisible();
  await expect(page.getByText("طلبات بانتظار المراجعة",{exact:true})).toBeVisible();

  await page.getByRole("link",{name:"الحجوزات",exact:true}).click();
  await expect(page).toHaveURL(/\/admin\/bookings\?lang=ar$/);
  await expect(page.getByRole("heading",{name:"الحجوزات",exact:true})).toBeVisible();
  await expect(page.getByRole("link",{name:"English",exact:true})).toBeVisible();

  await page.getByRole("link",{name:"الموارد والتكليفات",exact:true}).click();
  await page.getByRole("button",{name:"إنشاء مورد",exact:true}).click();
  await page.getByLabel("اسم المورد",{exact:true}).fill("مرشد تجريبي");
  await page.getByLabel("رمز المورد",{exact:true}).fill("arabic-guide");
  await page.getByRole("combobox",{name:"النوع",exact:true}).selectOption("guide");
  await page.getByRole("combobox",{name:"نموذج السعة",exact:true}).selectOption("exclusive");
  await page.getByRole("button",{name:"حفظ",exact:true}).click();
  await expect.poll(()=>createdResource).toMatchObject({name:"مرشد تجريبي",code:"arabic-guide",kind:"guide",mode:"exclusive"});
});
