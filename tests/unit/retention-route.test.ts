import {afterEach,expect,it,vi} from "vitest";

const cleanup=vi.hoisted(()=>vi.fn());
vi.mock("@/modules/photography/retention",()=>({cleanupExpiredMedia:cleanup}));
import {GET} from "@/app/api/internal/retention/route";
afterEach(()=>{vi.unstubAllEnvs();cleanup.mockReset();});
const request=()=>new Request("http://localhost/api/internal/retention",{headers:{authorization:`Bearer ${"a".repeat(40)}`}});
it("retention cron rejects unauthenticated access before touching media",async()=>{
  vi.stubEnv("CRON_SECRET","a".repeat(40));
  expect((await GET(new Request("http://localhost/api/internal/retention"))).status).toBe(401);
  expect(cleanup).not.toHaveBeenCalled();
});
it("retention cron previews an unapproved policy and returns counts without asset IDs",async()=>{
  vi.stubEnv("CRON_SECRET","a".repeat(40));vi.stubEnv("RETENTION_POLICY_APPROVED","false");
  cleanup.mockResolvedValue({dryRun:true,eligibleAssetIds:["private-asset"],purgedAssetIds:[],failedAssetIds:[]});
  const response=await GET(request()),body=await response.json();
  expect(cleanup).toHaveBeenCalledWith({dryRun:true,limit:25});
  expect(response.status).toBe(200);expect(JSON.stringify(body)).not.toContain("private-asset");
});
it("retention cron executes an approved policy and fails partial storage deletion",async()=>{
  vi.stubEnv("CRON_SECRET","a".repeat(40));vi.stubEnv("RETENTION_POLICY_APPROVED","true");
  cleanup.mockResolvedValue({dryRun:false,eligibleAssetIds:["private-asset"],purgedAssetIds:[],failedAssetIds:["private-asset"]});
  const response=await GET(request());
  expect(cleanup).toHaveBeenCalledWith({dryRun:false,limit:25});
  expect(response.status).toBe(503);expect(await response.text()).not.toContain("private-asset");
});
