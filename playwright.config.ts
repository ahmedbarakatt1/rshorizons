import {defineConfig,devices} from "@playwright/test";
export default defineConfig({
 testDir:"./tests/e2e",fullyParallel:false,workers:1,timeout:60000,expect:{timeout:15000},retries:process.env.CI?1:0,
 reporter:[["list"],["html",{open:"never"}]],
 use:{baseURL:process.env.E2E_BASE_URL??"http://127.0.0.1:3000",trace:"retain-on-failure",screenshot:"only-on-failure"},
 projects:[{name:"chromium",use:{...devices["Desktop Chrome"]}},{name:"firefox",use:{...devices["Desktop Firefox"]}},{name:"webkit",use:{...devices["Desktop Safari"]}}],
 ...(process.env.E2E_BASE_URL?{}:{webServer:{command:"npm run dev",url:"http://127.0.0.1:3000/api/v1/health/live",reuseExistingServer:!process.env.CI,timeout:120000}})
});
