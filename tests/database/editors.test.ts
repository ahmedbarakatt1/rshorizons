import {beforeAll,afterAll,expect,test} from "vitest";
import {admin,makeActor} from "./helpers";
const db=admin();beforeAll(()=>db.connect());afterAll(()=>db.end());
async function serviceData(){
 const category=(await db.query("SELECT id FROM app.categories LIMIT 1")).rows[0].id,destination=(await db.query("SELECT id FROM app.destinations LIMIT 1")).rows[0].id;
 return {categoryId:category,destinationId:destination,durationMinutes:60,cutoffMinutes:30,locale:"en",title:"Synthetic service",slug:"test-"+crypto.randomUUID(),summary:"Synthetic editorial fixture"};
}
test("staff_editor_permission_and_version_checks",async()=>{
 const owner=await makeActor(db),photographer=await makeActor(db,"photographer"),data=await serviceData();
 await expect(db.query("SELECT app.staff_edit('services',NULL,NULL,$1,$2)",[JSON.stringify(data),photographer])).rejects.toThrow("FORBIDDEN");
 const service=(await db.query("SELECT app.staff_edit('services',NULL,NULL,$1,$2) r",[JSON.stringify(data),owner])).rows[0].r;
 expect(service.status).toBe("draft");
 await expect(db.query("SELECT app.staff_edit('services',$1,99,$2,$3)",[service.id,JSON.stringify(data),owner])).rejects.toThrow("VERSION_CONFLICT");
 const updated=(await db.query("SELECT app.staff_edit('services',$1,1,$2,$3) r",[service.id,JSON.stringify({...data,title:"Updated synthetic title"}),owner])).rows[0].r;
 expect(updated.version).toBe(2);
});
test("staff_editor_scope_checked_before_mutation",async()=>{
 const actor=await makeActor(db,"operations"),data=await serviceData();
 await db.query("DELETE FROM app.staff_scopes WHERE staff_id=$1",[actor]);
 await expect(db.query("SELECT app.staff_edit('departures',NULL,NULL,$1,$2)",[JSON.stringify({variantId:(await db.query("SELECT id FROM app.service_variants LIMIT 1")).rows[0].id,startsAt:"2027-12-01T09:00:00+02:00",endsAt:"2027-12-01T12:00:00+02:00",cutoffAt:"2027-11-30T09:00:00+02:00",seatCapacity:10}),actor])).rejects.toThrow("SCOPE_FORBIDDEN");
 expect(data.locale).toBe("en");
});
test("staff_publish_requires_every_enabled_translation",async()=>{
 const actor=await makeActor(db),data=await serviceData(),service=(await db.query("SELECT app.staff_edit('services',NULL,NULL,$1,$2) r",[JSON.stringify(data),actor])).rows[0].r;
 await expect(db.query("SELECT app.publish_content('services',$1,1,$2)",[service.id,actor])).rejects.toThrow("TRANSLATIONS_OR_POLICY_UNAPPROVED");
});
test("last_active_owner_cannot_be_removed",async()=>{
 await db.query("BEGIN");
 try{
  const actor=await makeActor(db);
  await db.query("UPDATE app.staff_profiles SET active=false WHERE id<>$1",[actor]);
  await expect(db.query("SELECT app.staff_edit('staff_access',$1,1,'{\"active\":false}',$1)",[actor])).rejects.toThrow("LAST_ACTIVE_OWNER");
 }finally{await db.query("ROLLBACK");}
});
test("property_and_apartment_policy_configuration_is_scoped",async()=>{
 const actor=await makeActor(db),destination=(await db.query("SELECT id FROM app.destinations LIMIT 1")).rows[0].id;
 const property=(await db.query("SELECT app.staff_edit('properties',NULL,NULL,$1,$2) r",[JSON.stringify({destinationId:destination,name:"Synthetic property",address:"Synthetic address"}),actor])).rows[0].r;
 expect(property.name).toBe("Synthetic property");
 expect(property.version).toBe(1);
});
