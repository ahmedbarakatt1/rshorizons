import {randomUUID} from "node:crypto";
import {afterAll,beforeAll,expect,test} from "vitest";
import {admin,makeActor,makeBooking,stayItem} from "../database/helpers";
import {editorSchemas} from "@/server/api/admin-writes";
import {productionDataProblems} from "@/server/env/release-data";
const db=admin();let actor:string;
beforeAll(async()=>{await db.connect();actor=await makeActor(db);});
afterAll(()=>db.end());
test("production_data_gate_rejects_synthetic_catalog_and_local_operator_state",async()=>{
 expect(await productionDataProblems()).toContain("synthetic_records");
});
test("vehicle_editor_persists_validated_seats_luggage_and_prevents_capacity_change_in_use",async()=>{
 const input=editorSchemas.resources.parse({kind:"vehicle",code:`vehicle-${randomUUID()}`,name:"Synthetic six seat van",mode:"shared",capacity:6,metadata:{seats:6,luggage:5,vehicleKind:"van"}});
 const resource=(await db.query("SELECT app.staff_edit('resources',NULL,NULL,$1,$2) r",[input,actor])).rows[0].r;
 expect((await db.query("SELECT metadata FROM app.resource_details WHERE resource_id=$1",[resource.id])).rows[0].metadata).toEqual({seats:6,luggage:5,vehicleKind:"van"});
 await db.query("SELECT app.staff_edit('resources_block',$1,1,$2,$3)",[resource.id,{startsAt:"2033-01-01T12:00:00Z",endsAt:"2033-01-01T14:00:00Z",reason:"Synthetic maintenance"},actor]);
 await expect(db.query("SELECT app.staff_edit('resources',$1,2,$2,$3)",[resource.id,{metadata:{seats:2,luggage:1}},actor])).rejects.toThrow("RESOURCE_IN_USE");
 expect(editorSchemas.resources.safeParse({kind:"vehicle",code:"bad-van",name:"Van",mode:"shared",capacity:6,metadata:{seats:-1,luggage:0}}).success).toBe(false);
});
test("apartment_editor_keeps_rules_amenities_fees_and_quote_snapshot",async()=>{
 const property=(await db.query("SELECT id FROM app.properties LIMIT 1")).rows[0].id,amenity=(await db.query("SELECT id FROM app.amenities LIMIT 1")).rows[0].id;
 const cancellationPolicyVersionId=(await db.query("SELECT id FROM app.policy_versions WHERE policy_type='cancellation' AND locale='en' AND approved_at IS NOT NULL LIMIT 1")).rows[0].id;
 const input=editorSchemas.apartments.parse({propertyId:property,unitCode:randomUUID(),bedrooms:1,beds:2,bathrooms:1,maxGuests:4,nightlyAmountMinor:"100000",currency:"EGP",locale:"en",slug:`stay-${randomUUID()}`,title:"Synthetic editor stay",description:"Fixture",minNights:2,cleaningBufferDays:1,checkInTime:"16:00",checkOutTime:"10:00",houseRules:["No smoking"],amenityIds:[amenity],cleaningFeeMinor:"12500",cancellationPolicyVersionId});
 const apartment=(await db.query("SELECT app.staff_edit('apartments',NULL,NULL,$1,$2) a",[input,actor])).rows[0].a;
 expect(apartment.check_in_time).toBe("16:00:00");expect(apartment.cleaning_buffer_days).toBe(1);
 expect((await db.query("SELECT house_rules FROM app.apartment_translations WHERE apartment_id=$1",[apartment.id])).rows[0].house_rules).toEqual(["No smoking"]);
 expect((await db.query("SELECT amenity_id FROM app.apartment_amenities WHERE apartment_id=$1",[apartment.id])).rows[0].amenity_id).toBe(amenity);
 await db.query("UPDATE app.apartment_translations SET approved_at=now() WHERE apartment_id=$1",[apartment.id]);
 await db.query("INSERT INTO app.apartment_payment_policies SELECT $1,id FROM app.payment_policies",[apartment.id]);
 const {booking}=await makeBooking(db,[await stayItem(db,apartment.id,80,2)]);
 expect(booking.total_amount).toBe("212500");
 await db.query("SELECT app.staff_edit('apartments',$1,1,$2,$3)",[apartment.id,{cleaningFeeMinor:"30000",nightlyAmountMinor:"200000"},actor]);
 expect((await db.query("SELECT total_amount FROM app.bookings WHERE id=$1",[booking.id])).rows[0].total_amount).toBe("212500");
});
