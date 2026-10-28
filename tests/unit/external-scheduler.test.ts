import {readFileSync} from "node:fs";
import {afterEach,expect,it,vi} from "vitest";
const jobs=vi.hoisted(()=>({runJobs:vi.fn(),sendOperationalAlert:vi.fn()}));
vi.mock("@/modules/jobs/worker",()=>jobs);
import {GET as worker} from "@/app/api/internal/worker/route";
import {GET as monitor} from "@/app/api/internal/monitor/route";
afterEach(()=>{vi.unstubAllEnvs();vi.resetAllMocks();});
it("deploys without Vercel-managed paid cron schedules while retaining release validation",()=>{
  const config=JSON.parse(readFileSync("vercel.json","utf8"));
  expect(config.crons??[]).toEqual([]);
  expect(config.buildCommand).toBe("npm run verify:release && npm run build");
});
it.each([worker,monitor])("rejects missing, short and incorrect scheduler secrets before work",async handler=>{
  for(const [secret,authorization] of [["",null],["short","Bearer short"],["s".repeat(40),null],["s".repeat(40),"Bearer incorrect"]]){
    vi.stubEnv("CRON_SECRET",secret!);
    const request=new Request("https://example.test/api/internal/worker",{headers:authorization?{authorization}:{}});
    expect((await handler(request)).status).toBe(401);
  }
  expect(jobs.runJobs).not.toHaveBeenCalled();expect(jobs.sendOperationalAlert).not.toHaveBeenCalled();
});
it("accepts the external scheduler bearer header without trusting a Vercel user agent",async()=>{
  vi.stubEnv("CRON_SECRET","s".repeat(40));
  jobs.runJobs.mockResolvedValue({claimed:0,complete:0});jobs.sendOperationalAlert.mockResolvedValue({unhealthy:false});
  const request=()=>new Request("https://example.test/api/internal/worker",{headers:{authorization:`Bearer ${"s".repeat(40)}`,"user-agent":"pg_net"}});
  expect((await worker(request())).status).toBe(200);
  expect(jobs.runJobs).toHaveBeenCalledWith(20);
  expect((await monitor(request())).status).toBe(200);
  expect(jobs.sendOperationalAlert).toHaveBeenCalledOnce();
});
