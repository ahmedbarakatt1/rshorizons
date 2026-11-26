import {describe, expect, it} from "vitest";
import {route} from "@/server/api/router";
import {automatedEmailEnabled, websiteCheckoutEnabled} from "@/config/customer-service";
import {productionDataProblems} from "@/server/env/release-data";
import {sendEmail} from "@/integrations/messaging/notifications";

describe("deployed customer-service booking policy", () => {
  it("keeps website checkout and automated email disabled", async () => {
    expect(websiteCheckoutEnabled).toBe(false);
    expect(automatedEmailEnabled).toBe(false);
    await expect(sendEmail({to:"fixture@example.invalid",subject:"Test",text:"Test",idempotencyKey:"disabled"}))
      .rejects.toMatchObject({code:"AUTOMATED_EMAIL_DISABLED"});
    expect(await productionDataProblems()).not.toContain("notification_templates_missing");
  });

  it.each([
    ["quotes", "CONTACT_CUSTOMER_SERVICE"],
    ["bookings", "CONTACT_CUSTOMER_SERVICE"],
    ["bookings/example/payment-attempts", "CONTACT_CUSTOMER_SERVICE"],
    ["contact", "CONTACT_CUSTOMER_SERVICE"],
    ["guest-access/request", "AUTOMATED_EMAIL_DISABLED"],
  ])("returns the customer-service response for %s", async (path, code) => {
    const request = new Request(`http://127.0.0.1/api/v1/${path}`, {method: "POST"});
    const response = await route(request, path.split("/"));
    expect(response.status).toBe(410);
    expect((await response.json()).error.code).toBe(code);
  });
});
