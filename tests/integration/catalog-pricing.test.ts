import {randomUUID} from "node:crypto";
import {beforeAll,afterAll,test,expect} from "vitest";
import {admin} from "../database/helpers";
import {getService,searchServices} from "@/modules/catalog";
const db=admin(),service=randomUUID(),variant=randomUUID(),unapproved=randomUUID(),unpriced=randomUUID();
let future:string;
beforeAll(async()=>{
 await db.connect();
 await db.query("INSERT INTO app.services(id,category_id,destination_id,status,duration_minutes,synthetic) SELECT $1,category_id,destination_id,'published',60,true FROM app.services LIMIT 1",[service]);
 await db.query("INSERT INTO app.service_translations(service_id,locale,slug,title,summary,approved_at) VALUES($1,'en',$1::uuid::text,'Synthetic price selection','Price selection regression',now())",[service]);
 for(const id of [variant,unapproved,unpriced]){
  await db.query("INSERT INTO app.service_variants(id,service_id,variant_code,capacity_model,pricing_unit,duration_minutes) VALUES($1,$2,$1::uuid::text,'departure','person',60)",[id,service]);
  await db.query("INSERT INTO app.variant_translations(variant_id,locale,title,approved_at) VALUES($1,'en',$1::uuid::text,CASE WHEN $2 THEN now() ELSE NULL END)",[id,id!==unapproved]);
 }
 await db.query("INSERT INTO app.price_rules(variant_id,guest_category,effective_range,currency,amount,priority) VALUES($1,'adult',daterange(current_date-1,current_date+90,'[)'),'EGP',100,0),($1,'adult',daterange(current_date-1,current_date+90,'[)'),'EGP',600,10),($2,'adult',daterange(current_date-1,current_date+90,'[)'),'EGP',1,0)",[variant,unapproved]);
 future=(await db.query("SELECT (current_date+40)::text AS service_date")).rows[0].service_date;
 await db.query("INSERT INTO app.price_rules(variant_id,guest_category,effective_range,currency,amount,priority) VALUES($1,'adult',daterange($2::date,$2::date+1,'[)'),'EGP',900,20)",[variant,future]);
 await db.query("INSERT INTO app.departures(variant_id,starts_at,ends_at,seat_capacity,cutoff_at) VALUES($1,($2::date+time '09:00') AT TIME ZONE 'Africa/Cairo',($2::date+time '10:00') AT TIME ZONE 'Africa/Cairo',10,($2::date+time '08:00') AT TIME ZONE 'Africa/Cairo')",[variant,future]);
});
afterAll(()=>db.end());
test("advertised price follows effective priority and excludes unapproved or unpriced variants",async()=>{
 const detail=await getService(service,"en");
 expect(detail.fromAmountMinor).toBe("600");expect(detail.currency).toBe("EGP");
 expect(detail.variants.map(v=>v.id)).toEqual([variant]);
 expect(detail.variants[0].priceAmountMinor).toBe("600");
});
test("date-filtered advertised price uses the selected Cairo service date",async()=>{
 const cursor=service.slice(0,-12)+(BigInt(`0x${service.slice(-12)}`)-1n).toString(16).padStart(12,"0");
 const result=await searchServices({date:future,cursor},"en");
 expect(result.items.find(item=>item.id===service)?.fromAmountMinor).toBe("900");
});
