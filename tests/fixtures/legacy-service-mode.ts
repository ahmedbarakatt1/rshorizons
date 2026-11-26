// Exercise the retained checkout and email implementations in isolation.
// Import only from suites whose fixtures depend on that historical workflow.
// The deployed settings are covered separately by customer-service-mode.test.ts.
import {vi} from "vitest";

vi.mock("@/config/customer-service", async importOriginal => ({
  ...await importOriginal<typeof import("@/config/customer-service")>(),
  websiteCheckoutEnabled: true,
  automatedEmailEnabled: true,
}));
