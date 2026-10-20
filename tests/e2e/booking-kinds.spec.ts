import {test,expect} from "@playwright/test";

for(const kind of ["stay","transfer","shared-transfer","photography","tour-addon"] as const){
  test(`${kind} submits a complete request awaiting staff approval`,async({page},info)=>{
    test.skip(info.project.name!=="chromium","Public checkout behavior is separately covered on all three engines.");
    await page.goto(kind==="stay"?"/en/apartments/demo-1":`/en/experiences/${kind==="transfer"||kind==="shared-transfer"?"transportation":kind==="photography"?"photography":"boat-tours"}`);
    await page.getByRole("link",{name:kind==="stay"?"Request this stay":"Request this experience"}).click();
    if(kind==="stay"){
      await page.getByLabel("Check-in",{exact:true}).fill("2027-07-01");
      await page.getByLabel("Check-out",{exact:true}).fill("2027-07-04");
    }else if(kind==="transfer"||kind==="shared-transfer"||kind==="photography"){
      if(kind==="transfer")await page.getByLabel("Details",{exact:true}).selectOption("0356300f-fc64-0e75-5777-ae6ad03cb5d6");
      if(kind==="shared-transfer"){
        await page.getByLabel("Details",{exact:true}).selectOption({label:"Shared transfer — development fixture"});
        await expect(page.getByLabel("Requested start (Africa/Cairo)",{exact:true})).toHaveCount(0);
        await expect(page.getByLabel("Departure",{exact:true})).toBeVisible();
      }else await page.getByLabel("Requested start (Africa/Cairo)",{exact:true}).fill("2027-07-01T09:00");
      if(kind==="transfer"||kind==="shared-transfer"){
        await page.getByLabel("Pickup address",{exact:true}).fill("Local test airport pickup");
        await page.getByLabel("Destination address",{exact:true}).fill("Local test hotel destination");
        await page.getByLabel("Luggage count").fill("1");
      }
    }else{
      await page.locator('input[name^="addon-"]').first().check();
    }
    const selectedDeparture=kind==="shared-transfer"?await page.getByLabel("Departure",{exact:true}).inputValue():undefined;
    const quoted=page.waitForResponse(response=>response.url().endsWith("/api/v1/quotes")&&response.request().method()==="POST");
    await page.getByRole("button",{name:"Calculate my quote"}).click();
    const quoteResponse=await quoted;
    expect(quoteResponse.status()).toBe(201);
    if(kind==="shared-transfer"){
      const item=quoteResponse.request().postDataJSON().items[0];
      expect(item.departureId).toBe("90ac23cb-7ba9-0560-e2e8-b1225af1612a");
      expect(new Date(item.pickupAt).getTime()).toBeGreaterThan(Date.now());
      expect(selectedDeparture).toBe(item.departureId);
      // Cairo 09:00 is preserved across seasonal UTC offsets.
      expect(new Intl.DateTimeFormat("en-GB",{timeZone:"Africa/Cairo",hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date(item.pickupAt))).toBe("09:00");
    }
    await expect(page.getByRole("heading",{name:"Your quote"})).toBeVisible();
    if(kind==="stay"){await expect(page.getByRole("heading",{name:"Nightly breakdown"})).toBeVisible();await expect(page.getByText("Cleaning fee",{exact:true})).toBeVisible();await expect(page.locator(".quote-breakdown summary")).toContainText("Cancellation policy");}
    if(kind==="tour-addon")await expect(page.locator(".quote-panel .price-line").filter({has:page.locator("span")})).toHaveCount(3);
    await page.getByLabel("Full name",{exact:true}).fill(`Local ${kind} browser test`);
    await page.getByLabel("Email",{exact:true}).fill(`local-${kind}@example.test`);
    await page.getByLabel("Participant 1",{exact:true}).fill("Local test participant");
    await page.getByLabel("I accept the terms").check();
    await page.getByLabel("I have read the privacy notice").check();
    const submitted=page.waitForResponse(response=>response.url().endsWith("/api/v1/bookings")&&response.request().method()==="POST");
    await page.getByRole("button",{name:"Send reservation request"}).click();
    const response=await submitted;
    expect(response.status()).toBe(201);
    const result=await response.json();
    expect(result.data.status).toBe("pending_review");
    expect(result.data.paymentRequested).toBe(false);
    await expect(page.getByText("Your reservation request has been received and is awaiting staff approval. It is not confirmed yet.")).toBeVisible();
    await page.locator(".receipt-panel").getByRole("link",{name:"My reservation",exact:true}).click();
    await expect(page.locator(".status-heading")).toContainText(result.data.reference);
    await expect(page.locator(".status-heading")).toContainText("Awaiting staff approval");
  });
}
