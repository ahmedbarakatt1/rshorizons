import {config} from "dotenv";
import {readEnvironment} from "../src/server/env";
config({path: ".env.local", quiet: true});
try {
  const environment=readEnvironment("production");
  console.log(`Production configuration validated for ${new URL(environment.baseUrl).hostname}. Provider and content evidence must also pass release checks.`);
} catch(error) {
  console.error(error instanceof Error ? error.message : "Configuration rejected");
  process.exitCode=1;
}
