import {randomUUID} from "node:crypto";
import {afterAll,afterEach,beforeAll,expect,test,vi} from "vitest";
import {admin,makeActor,makeBooking,makeDeparture,makeApartment,stayItem,tourItem,race} from "../database/helpers";
import {newSecret,digestSecret} from "@/server/security";
import {startPayment} from "@/modules/payments/service";
import {route} from "@/server/api/router";

const db=admin(),base="http://127.0.0.1:3000";
beforeAll(()=>db.connect());
afterAll(()=>db.end());
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
function providerConfiguration() {
  for(const [key,value] of Object.entries({
    PAYMOB_MODE:"sandbox",PAYMOB_API_BASE_URL:"https://accept.paymob.com",
    PAYMOB_SECRET_KEY:"synthetic-test-secret",PAYMOB_PUBLIC_KEY:"synthetic-test-public",
    PAYMOB_HMAC_SECRET:"synthetic-test-hmac",PAYMOB_ACCOUNT_ID:"123",
    PAYMOB_API_KEY:"synthetic-test-api",PAYMOB_INTEGRATION_IDS:"101",
    PAYMOB_CARD_INTEGRATION_IDS:"101",PAYMOB_WALLET_INTEGRATION_IDS:""
  }))vi.stubEnv(key,value);
}
async function approvedBooking() {
  const owner=await makeActor(db),departure=await makeDeparture(db,5);
  const {booking}=await makeBooking(db,[await tourItem(db,departure.id)],"full");
  await db.query("SELECT app.approve_booking($1,1,$2)",[booking.id,owner]);
  const obligation=(await db.query("SELECT id FROM app.payment_obligations WHERE booking_id=$1 AND kind='initial'",[booking.id])).rows[0].id;
  return {booking,obligation,departure};
}
const billing={firstName:"Synthetic",lastName:"Reviewer",email:"reviewer@example.invalid",phone:"+201000000001"};
async function clonedVariant(category:string,capacity?:string) {
  const variant=randomUUID();
  const original=(await db.query("SELECT v.id FROM app.service_variants v JOIN app.services s ON s.id=v.service_id JOIN app.categories c ON c.id=s.category_id WHERE c.code=$1 AND v.variant_code='standard' ORDER BY v.id LIMIT 1",[category])).rows[0].id;
  await db.query("INSERT INTO app.service_variants(id,service_id,variant_code,capacity_model,pricing_unit,duration_minutes) SELECT $1,service_id,$1::uuid::text,coalesce($3,capacity_model),pricing_unit,duration_minutes FROM app.service_variants WHERE id=$2",[variant,original,capacity??null]);
  await db.query("INSERT INTO app.variant_translations(variant_id,locale,title,description,approved_at) SELECT $1,locale,title,description,approved_at FROM app.variant_translations WHERE variant_id=$2",[variant,original]);
  await db.query("INSERT INTO app.price_rules(variant_id,guest_category,effective_range,currency,amount,priority) SELECT $1,guest_category,daterange(current_date-1,current_date+3650,'[)'),currency,amount,priority FROM app.price_rules WHERE variant_id=$2",[variant,original]);
  await db.query("INSERT INTO app.variant_payment_policies SELECT $1,policy_id FROM app.variant_payment_policies WHERE variant_id=$2",[variant,original]);
  return variant;
}
async function assignedResource(itemId:string,actor:string,kind:string,start:string,end:string,mode="exclusive",quantity=1,capacity=1,metadata:Record<string,number>={}) {
  const id=randomUUID();
  await db.query("INSERT INTO app.resources(id,kind,code,name,mode,capacity) VALUES($1,$2,$1::uuid::text,'Synthetic reviewer resource',$3,$4)",[id,kind,mode,capacity]);
  await db.query("INSERT INTO app.resource_details(resource_id,metadata) VALUES($1,$2)",[id,JSON.stringify(metadata)]);
  await db.query("SELECT app.assign_resource($1,NULL,$2,$3,$4,$5,$6)",[id,itemId,start,end,quantity,actor]);
  return id;
}
test("payment_idempotency_key_binds_method_and_billing_body",async()=>{
  providerConfiguration();
  const fixture=await approvedBooking(),order=String(Date.now());
  const fetchMock=vi.fn(async()=>new Response(JSON.stringify({id:randomUUID(),intention_order_id:order,client_secret:"synthetic-secret"}),{status:200,headers:{"content-type":"application/json"}}));
  vi.stubGlobal("fetch",fetchMock);
  const actor={type:"guest" as const,id:randomUUID(),sessionHash:"synthetic",bookingId:fixture.booking.id,scope:["payment:create"]};
  const key=randomUUID(),input={obligationId:fixture.obligation,method:"card",billing};
  await expect(startPayment(actor,input,key)).resolves.toHaveProperty("checkoutUrl");
  await expect(startPayment(actor,{...input,billing:{...billing,lastName:"Changed"}},key)).rejects.toMatchObject({message:expect.stringContaining("IDEMPOTENCY_CONFLICT")});
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
test("unavailable_payment_method_does_not_poison_collectible_balance",async()=>{
  providerConfiguration();
  const fixture=await approvedBooking(),fetchMock=vi.fn();
  vi.stubGlobal("fetch",fetchMock);
  const actor={type:"guest" as const,id:randomUUID(),sessionHash:"synthetic",bookingId:fixture.booking.id,scope:["payment:create"]};
  await expect(startPayment(actor,{obligationId:fixture.obligation,method:"wallet",billing},randomUUID())).rejects.toMatchObject({code:"PAYMENT_METHOD_UNAVAILABLE"});
  expect(fetchMock).not.toHaveBeenCalled();
  const attempts=await db.query("SELECT id FROM app.payment_attempts WHERE booking_id=$1 AND status IN('creating','pending','unknown')",[fixture.booking.id]);
  expect(attempts.rowCount).toBe(0);
});
test("scoped_finance_cannot_reconcile_another_destination_payment",async()=>{
  providerConfiguration();
  const fixture=await approvedBooking(),staffId=await makeActor(db,"finance"),token=newSecret();
  const destination=(await db.query("SELECT destination_id FROM app.services s JOIN app.service_variants v ON v.service_id=s.id WHERE v.id=$1",[fixture.departure.variant_id])).rows[0].destination_id;
  await db.query("DELETE FROM app.staff_scopes WHERE staff_id=$1",[staffId]);
  await db.query("INSERT INTO app.staff_scopes(staff_id,scope_type,destination_id) SELECT $1,'destination',id FROM app.destinations WHERE id<>$2 LIMIT 1",[staffId,destination]);
  await db.query("INSERT INTO app.local_operator_sessions(staff_id,token_hash,expires_at,redeemed_at) VALUES($1,$2,now()+interval '1 hour',now())",[staffId,digestSecret(token)]);
  const attempt=(await db.query("SELECT app.create_payment_attempt($1,$2,$3,'paymob','sandbox') a",[fixture.booking.id,fixture.obligation,randomUUID()])).rows[0].a;
  const order=String(Date.now());
  await db.query("INSERT INTO app.payment_checkout_sessions(attempt_id,provider_ref) VALUES($1,$2)",[attempt.id,order]);
  const fetchMock=vi.fn(async(input:RequestInfo|URL)=>new Response(JSON.stringify(String(input).includes("auth/tokens")?{token:"synthetic-auth-token"}:{id:order,transactions:[]}),{status:200}));
  vi.stubGlobal("fetch",fetchMock);
  const path=`admin/payments/${attempt.id}/reconcile`;
  const result=await route(new Request(`${base}/api/v1/${path}`,{method:"POST",headers:{origin:base,cookie:`rsh_local_staff=${token}`,"content-type":"application/json"},body:"{}"}),path.split("/"));
  expect(result.status).toBe(403);
  expect(fetchMock).not.toHaveBeenCalled();
});
test("departure_variant_cannot_be_reclassified_as_transfer_to_skip_seats",async()=>{
  const departure=await makeDeparture(db,1);
  const input={bindingHash:digestSecret(newSecret()),locale:"en",paymentPolicy:"arrival",items:[{kind:"transfer",variantId:departure.variant_id,pickupAt:departure.starts_at.toISOString(),pickup:"Synthetic pickup",dropoff:"Synthetic dropoff",passengers:2,luggage:0}]};
  await expect(db.query("SELECT app.create_quote($1) q",[JSON.stringify(input)])).rejects.toThrow();
});
test("approval_revalidates_variant_inventory_model_after_quote",async()=>{
  const variant=randomUUID(),owner=await makeActor(db),original=await makeDeparture(db);
  await db.query("INSERT INTO app.service_variants(id,service_id,variant_code,capacity_model,pricing_unit,duration_minutes) SELECT $1,service_id,$1::uuid::text,capacity_model,pricing_unit,duration_minutes FROM app.service_variants WHERE id=$2",[variant,original.variant_id]);
  await db.query("INSERT INTO app.variant_translations(variant_id,locale,title,description,approved_at) SELECT $1,locale,title,description,approved_at FROM app.variant_translations WHERE variant_id=$2",[variant,original.variant_id]);
  await db.query("INSERT INTO app.price_rules(variant_id,guest_category,effective_range,currency,amount,priority) SELECT $1,guest_category,daterange(current_date-1,current_date+3650,'[)'),currency,amount,priority FROM app.price_rules WHERE variant_id=$2",[variant,original.variant_id]);
  await db.query("INSERT INTO app.variant_payment_policies SELECT $1,policy_id FROM app.variant_payment_policies WHERE variant_id=$2",[variant,original.variant_id]);
  const departure=(await db.query("INSERT INTO app.departures(variant_id,starts_at,ends_at,seat_capacity,cutoff_at) SELECT $1,starts_at,ends_at,seat_capacity,cutoff_at FROM app.departures WHERE id=$2 RETURNING id",[variant,original.id])).rows[0].id;
  const {booking}=await makeBooking(db,[await tourItem(db,departure)]);
  await db.query("UPDATE app.service_variants SET capacity_model='none' WHERE id=$1",[variant]);
  await expect(db.query("SELECT app.approve_booking($1,1,$2)",[booking.id,owner])).rejects.toThrow("ITEM_KIND_VARIANT_MISMATCH");
  expect((await db.query("SELECT status FROM app.bookings WHERE id=$1",[booking.id])).rows[0].status).toBe("pending_review");
  expect((await db.query("SELECT count(*)::int n FROM app.capacity_allocations WHERE departure_id=$1",[departure])).rows[0].n).toBe(0);
});
test("read_only_booking_grant_cannot_request_cancellation",async()=>{
  const departure=await makeDeparture(db),{booking}=await makeBooking(db,[await tourItem(db,departure.id)]),token=newSecret();
  const grant=(await db.query("INSERT INTO app.access_grants(token_hash,purpose,booking_id,scope,expires_at) VALUES($1,'booking',$2,ARRAY['booking:read'],now()+interval '1 hour') RETURNING id",[digestSecret(newSecret()),booking.id])).rows[0].id;
  await db.query("INSERT INTO app.guest_sessions(session_hash,grant_id,scope,expires_at) VALUES($1,$2,ARRAY['booking:read'],now()+interval '1 hour')",[digestSecret(token),grant]);
  const path=`bookings/${booking.reference}/cancellation-requests`;
  const result=await route(new Request(`${base}/api/v1/${path}`,{method:"POST",headers:{origin:base,cookie:`rsh_guest=${token}`,"content-type":"application/json"},body:JSON.stringify({reason:"Read-only token must not allow this mutation"})}),path.split("/"));
  expect(result.status).toBe(403);
  expect((await db.query("SELECT count(*)::int n FROM app.booking_requests WHERE booking_id=$1",[booking.id])).rows[0].n).toBe(0);
});
test("past_same_day_transfer_cannot_be_quoted",async()=>{
  const variant=await clonedVariant("transportation");
  const input={bindingHash:digestSecret(newSecret()),locale:"en",paymentPolicy:"arrival",items:[{kind:"transfer",variantId:variant,pickupAt:new Date(Date.now()-60000).toISOString(),pickup:"Synthetic pickup",dropoff:"Synthetic dropoff",passengers:1,luggage:0}]};
  await expect(db.query("SELECT app.create_quote($1)",[JSON.stringify(input)])).rejects.toThrow();
});
test("photography_addon_uses_parent_departure_pricing_date",async()=>{
  const departure=await makeDeparture(db),variant=await clonedVariant("photography");
  const day=(await db.query("SELECT (starts_at AT TIME ZONE 'Africa/Cairo')::date::text pricing_date FROM app.departures WHERE id=$1",[departure.id])).rows[0].pricing_date;
  await db.query("INSERT INTO app.price_rules(variant_id,guest_category,effective_range,currency,amount,priority) VALUES($1,'adult',daterange($2::date,$2::date+1,'[)'),'EGP',123456,1000)",[variant,day]);
  await db.query("INSERT INTO app.service_addons(parent_service_id,addon_variant_id,pricing_unit,min_quantity,max_quantity) SELECT service_id,$2,'booking',1,1 FROM app.service_variants WHERE id=$1",[departure.variant_id,variant]);
  const input={bindingHash:digestSecret(newSecret()),locale:"en",paymentPolicy:"arrival",items:[await tourItem(db,departure.id),{kind:"addon",variantId:variant,parentPosition:0,departureId:departure.id,quantity:1}]};
  const quote=(await db.query("SELECT app.create_quote($1) q",[JSON.stringify(input)])).rows[0].q;
  expect(quote.items[1].total).toBe("123456");
});
test("shared_photography_still_requires_reserved_inventory",async()=>{
  const variant=await clonedVariant("photography","shared"),owner=await makeActor(db);
  const {booking}=await makeBooking(db,[{kind:"photography",variantId:variant,requestedStart:"2030-05-01T10:00:00+03:00",participants:1}]);
  await expect(db.query("SELECT app.approve_booking($1,1,$2)",[booking.id,owner])).rejects.toThrow("RESOURCE_ASSIGNMENT_REQUIRED");
});
test("transfer_approval_rejects_wrong_resource_kind",async()=>{
  const variant=await clonedVariant("transportation"),owner=await makeActor(db);
  const {booking}=await makeBooking(db,[{kind:"transfer",variantId:variant,pickupAt:"2030-05-01T10:00:00+03:00",pickup:"Synthetic pickup",dropoff:"Synthetic dropoff",passengers:1,luggage:0}]);
  const item=(await db.query("SELECT id FROM app.booking_items WHERE booking_id=$1",[booking.id])).rows[0].id;
  await assignedResource(item,owner,"guide","2030-05-01T10:00:00+03:00","2030-05-01T14:00:00+03:00");
  await expect(db.query("SELECT app.approve_booking($1,1,$2)",[booking.id,owner])).rejects.toThrow("RESOURCE_ASSIGNMENT_REQUIRED");
});
test("photographer_assignment_must_cover_the_entire_session",async()=>{
  const variant=await clonedVariant("photography"),owner=await makeActor(db);
  const {booking}=await makeBooking(db,[{kind:"photography",variantId:variant,requestedStart:"2030-05-01T10:00:00+03:00",participants:1}]);
  const item=(await db.query("SELECT id FROM app.booking_items WHERE booking_id=$1",[booking.id])).rows[0].id;
  await assignedResource(item,owner,"photographer","2030-05-01T08:00:00+03:00","2030-05-01T09:00:00+03:00");
  await expect(db.query("SELECT app.approve_booking($1,1,$2)",[booking.id,owner])).rejects.toThrow("RESOURCE_ASSIGNMENT_REQUIRED");
});
test("transfer_vehicle_must_fit_passengers_and_luggage",async()=>{
  const variant=await clonedVariant("transportation"),owner=await makeActor(db);
  const {booking}=await makeBooking(db,[{kind:"transfer",variantId:variant,pickupAt:"2030-05-01T10:00:00+03:00",pickup:"Synthetic pickup",dropoff:"Synthetic dropoff",passengers:3,luggage:3}]);
  const item=(await db.query("SELECT id FROM app.booking_items WHERE booking_id=$1",[booking.id])).rows[0].id;
  await assignedResource(item,owner,"vehicle","2030-05-01T10:00:00+03:00","2030-05-01T14:00:00+03:00","exclusive",1,1,{seats:2,luggage:2});
  await expect(db.query("SELECT app.approve_booking($1,1,$2)",[booking.id,owner])).rejects.toThrow("RESOURCE_ASSIGNMENT_REQUIRED");
});
test("transfer_with_suitable_reserved_vehicle_can_be_approved",async()=>{
  const variant=await clonedVariant("transportation"),owner=await makeActor(db);
  const {booking}=await makeBooking(db,[{kind:"transfer",variantId:variant,pickupAt:"2030-05-02T10:00:00+03:00",pickup:"Synthetic pickup",dropoff:"Synthetic dropoff",passengers:3,luggage:3}]);
  const item=(await db.query("SELECT id FROM app.booking_items WHERE booking_id=$1",[booking.id])).rows[0].id;
  await assignedResource(item,owner,"vehicle","2030-05-02T09:30:00+03:00","2030-05-02T14:30:00+03:00","exclusive",1,1,{seats:4,luggage:4});
  await expect(db.query("SELECT app.approve_booking($1,1,$2)",[booking.id,owner])).rejects.toThrow("DRIVER_ASSIGNMENT_REQUIRED");
  await assignedResource(item,owner,"driver","2030-05-02T09:30:00+03:00","2030-05-02T14:30:00+03:00");
  const result=await db.query("SELECT app.approve_booking($1,1,$2) booking",[booking.id,owner]);
  expect(result.rows[0].booking.status).toBe("confirmed");
});
test("one_departure_photographer_supports_multiple_approved_guest_addons",async()=>{
  const departure=await makeDeparture(db,4),owner=await makeActor(db),variant=await clonedVariant("photography");
  await db.query("INSERT INTO app.service_addons(parent_service_id,addon_variant_id,pricing_unit,min_quantity,max_quantity) SELECT service_id,$2,'booking',1,1 FROM app.service_variants WHERE id=$1",[departure.variant_id,variant]);
  const resource=randomUUID();
  await db.query("INSERT INTO app.resources(id,kind,code,name,mode,capacity) VALUES($1,'photographer',$1::uuid::text,'Synthetic shared departure photographer','exclusive',1)",[resource]);
  await db.query("SELECT app.assign_resource($1,d.id,NULL,d.starts_at,d.ends_at,1,$3) FROM app.departures d WHERE d.id=$2",[resource,departure.id,owner]);
  for(let i=0;i<2;i++){
    const {booking}=await makeBooking(db,[await tourItem(db,departure.id),{kind:"addon",variantId:variant,parentPosition:0,departureId:departure.id,quantity:1}]);
    const result=await db.query("SELECT app.approve_booking($1,1,$2) booking",[booking.id,owner]);
    expect(result.rows[0].booking.status).toBe("confirmed");
  }
  expect((await db.query("SELECT count(*)::int n FROM app.resource_occupancy WHERE resource_id=$1 AND released_at IS NULL",[resource])).rows[0].n).toBe(1);
});
async function sharedTransferFixture(capacity=2,luggage=2){
  const variant=await clonedVariant("transportation","shared"),owner=await makeActor(db);
  const departure=(await db.query("INSERT INTO app.departures(variant_id,starts_at,ends_at,seat_capacity,cutoff_at) VALUES($1,now()+interval '40 days',now()+interval '40 days 4 hours',$2,now()+interval '39 days') RETURNING *",[variant,capacity])).rows[0];
  for(const kind of ["vehicle","driver"]){
    const resource=randomUUID();
    await db.query("INSERT INTO app.resources(id,kind,code,name,mode,capacity) VALUES($1,$2,$1::uuid::text,'Synthetic shared transfer resource','exclusive',1)",[resource,kind]);
    if(kind==="vehicle")await db.query("INSERT INTO app.resource_details(resource_id,metadata) VALUES($1,$2)",[resource,{seats:capacity,luggage}]);
    await db.query("SELECT app.assign_resource($1,d.id,NULL,d.starts_at,d.ends_at,1,$3) FROM app.departures d WHERE d.id=$2",[resource,departure.id,owner]);
  }
  const item={kind:"transfer",variantId:variant,departureId:departure.id,pickupAt:departure.starts_at.toISOString(),pickup:"Synthetic pickup",dropoff:"Synthetic dropoff",passengers:1,luggage:1};
  return {owner,departure,item};
}
test("shared_transfer_requires_explicit_departure",async()=>{
  const variant=await clonedVariant("transportation","shared");
  await expect(makeBooking(db,[{kind:"transfer",variantId:variant,pickupAt:"2030-05-02T10:00:00+03:00",pickup:"Synthetic pickup",dropoff:"Synthetic dropoff",passengers:1,luggage:1}])).rejects.toThrow("SHARED_DEPARTURE_REQUIRED");
});
test("shared_transfer_riders_reuse_vehicle_and_driver_without_overselling",async()=>{
  const {owner,departure,item}=await sharedTransferFixture();
  for(let i=0;i<2;i++){
    const {booking}=await makeBooking(db,[item]);
    const approved=await db.query("SELECT app.approve_booking($1,1,$2) booking",[booking.id,owner]);
    expect(approved.rows[0].booking.status).toBe("confirmed");
  }
  const {booking}=await makeBooking(db,[item]);
  await expect(db.query("SELECT app.approve_booking($1,1,$2)",[booking.id,owner])).rejects.toThrow("INVENTORY_CONFLICT");
  expect((await db.query("SELECT count(*)::int n FROM app.resource_occupancy WHERE departure_id=$1 AND released_at IS NULL",[departure.id])).rows[0].n).toBe(2);
  expect((await db.query("SELECT sum(seats)::int n FROM app.capacity_allocations WHERE departure_id=$1 AND state<>'released'",[departure.id])).rows[0].n).toBe(2);
});
test("shared_transfer_final_seat_race_uses_independent_connections",async()=>{
  const {owner,departure,item}=await sharedTransferFixture(1,1);
  const first=await makeBooking(db,[item]),second=await makeBooking(db,[item]);
  const results=await race(db,"SELECT id FROM app.departures WHERE id=$1 FOR UPDATE",[departure.id],[first,second].map(({booking})=>client=>client.query("SELECT app.approve_booking($1,1,$2)",[booking.id,owner])));
  expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);
  expect(results.filter(r=>r.status==="rejected")).toHaveLength(1);
  expect((await db.query("SELECT sum(seats)::int n FROM app.capacity_allocations WHERE departure_id=$1 AND state<>'released'",[departure.id])).rows[0].n).toBe(1);
});
test("shared_transfer_luggage_capacity_is_collective",async()=>{
  const {owner,item}=await sharedTransferFixture(2,1);
  const first=await makeBooking(db,[item]),second=await makeBooking(db,[item]);
  await db.query("SELECT app.approve_booking($1,1,$2)",[first.booking.id,owner]);
  await expect(db.query("SELECT app.approve_booking($1,1,$2)",[second.booking.id,owner])).rejects.toThrow("RESOURCE_ASSIGNMENT_REQUIRED");
});
test("apartment_quote_separates_fee_lines_and_binds_approved_cancellation",async()=>{
  const apartment=await makeApartment(db);
  const policy=(await db.query("SELECT id,version,body FROM app.policy_versions WHERE policy_type='cancellation' AND locale='en' AND approved_at IS NOT NULL ORDER BY effective_at DESC LIMIT 1")).rows[0];
  await db.query("UPDATE app.apartments SET cancellation_policy_version_id=$2 WHERE id=$1",[apartment,policy.id]);
  await db.query("INSERT INTO app.apartment_fee_rules(apartment_id,kind,amount,currency,calculation_unit,refundable) VALUES($1,'cleaning',25000,'EGP','stay',false),($1,'service',5000,'EGP','night',false),($1,'security_deposit',10000,'EGP','stay',true)",[apartment]);
  const {quote}=await makeBooking(db,[await stayItem(db,apartment)],"full");
  expect(quote.total).toBe("245000");
  expect(quote.subtotal).toBe("200000");
  expect(quote.fees).toBe("45000");
  expect(quote.items[0].snapshot.fees).toEqual(expect.arrayContaining([
    expect.objectContaining({kind:"cleaning",amountMinor:"25000",refundable:false,calculationUnit:"stay"}),
    expect.objectContaining({kind:"service",amountMinor:"10000",refundable:false,calculationUnit:"night",quantity:2}),
    expect.objectContaining({kind:"security_deposit",amountMinor:"10000",refundable:true})
  ]));
  expect(quote.items[0].snapshot.cancellationPolicy).toMatchObject({id:policy.id,version:policy.version,body:policy.body,locale:"en"});
  await db.query("UPDATE app.apartment_fee_rules SET amount=1 WHERE apartment_id=$1",[apartment]);
  const saved=(await db.query("SELECT snapshot FROM app.quote_items WHERE quote_id=$1",[quote.id])).rows[0].snapshot;
  expect(saved.fees.find((f:{kind:string})=>f.kind==="cleaning").amountMinor).toBe("25000");
});
test("tour_pickup_surcharge_is_server_priced_and_snapshotted",async()=>{
  const variant=await clonedVariant("boat_tours"),pickup=randomUUID(),original=await makeDeparture(db);
  const departure=(await db.query("INSERT INTO app.departures(variant_id,starts_at,ends_at,seat_capacity,cutoff_at) SELECT $1,starts_at,ends_at,4,cutoff_at FROM app.departures WHERE id=$2 RETURNING id",[variant,original.id])).rows[0].id;
  await db.query("INSERT INTO app.pickup_locations(id,destination_id,name,address) SELECT $1,s.destination_id,'Synthetic hotel','Synthetic pickup address' FROM app.services s JOIN app.service_variants v ON v.service_id=s.id WHERE v.id=$2",[pickup,variant]);
  await db.query("INSERT INTO app.variant_pickups(variant_id,pickup_id,surcharge,currency,offset_minutes) VALUES($1,$2,7500,'EGP',-30)",[variant,pickup]);
  const {quote,booking}=await makeBooking(db,[{...await tourItem(db,departure),pickupId:pickup}]);
  expect(quote.total).toBe("107500");
  expect(quote.fees).toBe("7500");
  expect(quote.items[0].snapshot.fees).toEqual(expect.arrayContaining([expect.objectContaining({kind:"pickup",amountMinor:"7500"})]));
  const saved=(await db.query("SELECT t.pickup_snapshot FROM app.tour_booking_items t JOIN app.booking_items i ON i.id=t.booking_item_id WHERE i.booking_id=$1",[booking.id])).rows[0].pickup_snapshot;
  expect(saved).toMatchObject({id:pickup,name:"Synthetic hotel",surchargeAmountMinor:"7500"});
});
test("tour_pickup_must_belong_to_selected_variant",async()=>{
  const departure=await makeDeparture(db);
  const input={bindingHash:digestSecret(newSecret()),locale:"en",paymentPolicy:"arrival",items:[{...await tourItem(db,departure.id),pickupId:randomUUID()}]};
  await expect(db.query("SELECT app.create_quote($1)",[JSON.stringify(input)])).rejects.toThrow("PICKUP_UNAVAILABLE");
});
test("refund_policy_evidence_is_bound_by_server_not_client_calculation",async()=>{
  const fixture=await approvedBooking(),owner=await makeActor(db);
  const receipt=(await db.query("SELECT app.record_offline_receipt($1,100000,'EGP','cash','Synthetic review receipt',$2,$3) receipt",[fixture.booking.id,randomUUID(),owner])).rows[0].receipt;
  const refund=(await db.query("SELECT app.request_refund($1,NULL,$2,5000,$3,$4,$5) refund",[fixture.booking.id,receipt.id,"Operator reviewed accepted cancellation terms",{automatic:true,acceptedPolicySnapshot:{forged:true},sourceReceiptId:randomUUID()},owner])).rows[0].refund;
  expect(refund.policy_calculation).toMatchObject({
    manual:true,calculationMode:"authorized_manual_review",requestedAmountMinor:"5000",
    sourceReceiptId:receipt.id,operatorRationale:"Operator reviewed accepted cancellation terms"
  });
  expect(refund.policy_calculation.acceptedPolicySnapshot).toHaveProperty("termsVersion","demo-v1");
  expect(refund.policy_calculation.acceptedPolicySnapshot.forged).toBeUndefined();
  expect(refund.policy_calculation.acceptedItemPolicies[0].cancellationPolicy.version).toBe("demo-v1");
});
