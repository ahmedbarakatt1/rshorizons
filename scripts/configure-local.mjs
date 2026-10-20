import {readFile,writeFile} from "node:fs/promises";
import {randomBytes} from "node:crypto";
const path=new URL("../.env.local",import.meta.url);
let text=await readFile(path,"utf8").catch(()=>"");
const defaults={APP_ENV:"development",APP_BASE_URL:"http://127.0.0.1:3000",BOOKING_ENABLED:"true",DEMO_MODE:"true",PAYMOB_MODE:"local",STORAGE_PROVIDER:"local",EMAIL_PROVIDER:"local",VIDEO_PROVIDER:"local",THREE_ENABLED:"false",TOKEN_HASH_PEPPER:randomBytes(48).toString("base64url"),CRON_SECRET:randomBytes(48).toString("base64url")};
for(const [key,value] of Object.entries(defaults)) if(!new RegExp(`^${key}=`,"m").test(text))text+=`\n${key}=${value}`;
await writeFile(path,text.trim()+"\n",{mode:0o600});
console.log("Local development configuration prepared. Secret values were not printed.");
