import {expect,it} from "vitest";
import {ciBrowserEnvironment} from "../../scripts/prepare-ci-browser";
const fixture={CI:"true",APP_ENV:"test",DEMO_MODE:"true",GITHUB_ENV:"synthetic-ci-env",MIGRATION_DATABASE_URL:"postgresql://migrator:synthetic@127.0.0.1:55432/tourism_ci",DATABASE_URL:"postgresql://runtime:synthetic@127.0.0.1:55432/tourism_ci"};
it("gives browser checks a fresh database without changing their role credentials",()=>{
 const env=ciBrowserEnvironment(fixture);
 expect(new URL(env.DATABASE_URL).pathname).toBe("/tourism_ci_browser");
 expect(new URL(env.MIGRATION_DATABASE_URL).pathname).toBe("/tourism_ci_browser");
 expect(new URL(env.DATABASE_URL).username).toBe("runtime");
 expect(new URL(env.MIGRATION_DATABASE_URL).username).toBe("migrator");
});
it("refuses production, non-CI and unrelated database targets",()=>{
 for(const override of [{CI:"false"},{APP_ENV:"production"},{DEMO_MODE:"false"},{GITHUB_ENV:""},{DATABASE_URL:"postgresql://runtime:synthetic@example.org:55432/tourism_ci"},{MIGRATION_DATABASE_URL:"postgresql://migrator:synthetic@127.0.0.1:55432/tourism"}])expect(()=>ciBrowserEnvironment({...fixture,...override})).toThrow();
});
