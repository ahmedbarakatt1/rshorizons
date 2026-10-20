import {randomUUID} from "node:crypto";
import {afterAll,beforeAll,expect,test} from "vitest";
import {admin,makeActor} from "./helpers";
const db=admin();beforeAll(()=>db.connect());afterAll(()=>db.end());
test("pickup_editor_updates_authoritative_binding_with_scope_and_version",async()=>{
 const actor=await makeActor(db),variant=(await db.query("SELECT v.id,s.destination_id FROM app.service_variants v JOIN app.services s ON s.id=v.service_id WHERE v.id=md5('variant:boat_tours')::uuid")).rows[0];
 const data={destinationId:variant.destination_id,name:`Synthetic pickup ${randomUUID()}`,address:"Synthetic reception"};
 const pickup=(await db.query("SELECT app.edit_pickup('pickup_locations',NULL,NULL,$1,$2) r",[data,actor])).rows[0].r;
 const binding=(await db.query("SELECT app.edit_pickup('variant_pickups',NULL,NULL,$1,$2) r",[{variantId:variant.id,pickupId:pickup.id,surchargeAmountMinor:"7500",currency:"EGP",offsetMinutes:-30},actor])).rows[0].r;
 expect(binding.surcharge).toBe("7500");
 await expect(db.query("SELECT app.edit_pickup('variant_pickups',$1,99,$2,$3)",[binding.id,{surchargeAmountMinor:"1"},actor])).rejects.toThrow("VERSION_CONFLICT");
 await db.query("SELECT app.edit_pickup('variant_pickups',$1,1,$2,$3)",[binding.id,{surchargeAmountMinor:"8000"},actor]);
 expect((await db.query("SELECT surcharge FROM app.variant_pickups WHERE id=$1",[binding.id])).rows[0].surcharge).toBe("8000");
 await db.query("DELETE FROM app.staff_scopes WHERE staff_id=$1",[actor]);
 await expect(db.query("SELECT app.edit_pickup('pickup_locations',$1,1,$2,$3)",[pickup.id,{address:"Altered address"},actor])).rejects.toThrow("SCOPE_FORBIDDEN");
});
