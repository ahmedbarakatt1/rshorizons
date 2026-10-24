import {randomUUID} from 'node:crypto';
import {afterAll,afterEach,beforeAll,beforeEach,expect,test,vi} from 'vitest';
import pg from 'pg';
import {listReviewPage} from '@/modules/reviews/service';
const db=new pg.Client({connectionString:process.env.MIGRATION_DATABASE_URL});
vi.mock('@/server/db',()=>({query:(sql:string,values:unknown[])=>db.query(sql,values),withTransaction:vi.fn()}));
beforeAll(()=>db.connect());afterAll(()=>db.end());beforeEach(()=>db.query('BEGIN'));afterEach(()=>db.query('ROLLBACK'));
async function identityFixture() {
  const staffId = randomUUID();
  const guestId = randomUUID();
  await db.query("INSERT INTO app.locales(code,direction) VALUES('en','ltr') ON CONFLICT DO NOTHING");
  await db.query("INSERT INTO app.currencies(code,exponent) VALUES('EUR',2) ON CONFLICT DO NOTHING");
  await db.query("INSERT INTO auth.users(id,email) VALUES($1,'staff@example.invalid')", [staffId]);
  await db.query("INSERT INTO app.staff_profiles(id,name,active) VALUES($1,'Synthetic media tester',true)", [staffId]);
  await db.query("INSERT INTO app.guests(id,full_name,email,locale) VALUES($1,'Synthetic media guest','guest@example.invalid','en')", [guestId]);
  return {staffId, guestId};
}


async function reviewFixture(fulfilmentState = "fulfilled") {
  const {staffId, guestId} = await identityFixture();
  const destinationId = randomUUID(), categoryId = randomUUID(), serviceId = randomUUID();
  const variantId = randomUUID(), policyId = randomUUID(), quoteId = randomUUID();
  const quoteItemId = randomUUID(), bookingId = randomUUID(), itemId = randomUUID(), invitationId = randomUUID();
  await db.query("INSERT INTO app.destinations(id,canonical_slug) VALUES($1,$1::uuid::text)", [destinationId]);
  await db.query("INSERT INTO app.categories(id,code) VALUES($1,$1::uuid::text)", [categoryId]);
  await db.query("INSERT INTO app.services(id,category_id,destination_id,duration_minutes) VALUES($1,$2,$3,60)", [serviceId, categoryId, destinationId]);
  await db.query(`INSERT INTO app.service_variants(id,service_id,variant_code,capacity_model,pricing_unit,duration_minutes)
    VALUES($1,$2,'test','exclusive','booking',60)`, [variantId, serviceId]);
  await db.query("INSERT INTO app.payment_policies(id,code,version,type) VALUES($1,$1::uuid::text,1,'arrival')", [policyId]);
  await db.query(`INSERT INTO app.quotes(id,binding_hash,locale,currency,subtotal,total,initial_due,payment_policy_id,inputs_hash,inputs,policy_snapshot,valid_until)
    VALUES($1,'synthetic','en','EUR',100,100,0,$2,'synthetic','{}','{}',now()+interval '1 hour')`, [quoteId, policyId]);
  await db.query(`INSERT INTO app.quote_items(id,quote_id,position,kind,variant_id,title,quantity,total,initial_due,snapshot)
    VALUES($1,$2,0,'transfer',$3,'Synthetic transfer',1,100,0,'{}')`, [quoteItemId, quoteId, variantId]);
  await db.query(`INSERT INTO app.bookings(id,reference,primary_guest_id,accepted_quote_id,status,currency,total_amount,initial_due_amount,approved_by,approved_at,price_snapshot,policy_snapshot)
    VALUES($1,$1::uuid::text,$2,$3,'completed','EUR',100,0,$4,now(),'{}','{}')`, [bookingId, guestId, quoteId, staffId]);
  await db.query(`INSERT INTO app.booking_items(id,booking_id,quote_item_id,kind,title_snapshot,quantity,total_amount,fulfilment_state)
    VALUES($1,$2,$3,'transfer','Synthetic transfer',1,100,$4)`, [itemId, bookingId, quoteItemId, fulfilmentState]);
  await db.query(`INSERT INTO app.transfer_booking_items(booking_item_id,variant_id,pickup,dropoff,pickup_at,passengers,luggage)
    VALUES($1,$2,'Synthetic pickup','Synthetic dropoff',now(),1,0)`, [itemId, variantId]);
  await db.query(`INSERT INTO app.review_invitations(id,booking_item_id,eligible_at,expires_at)
    VALUES($1,$2,now()-interval '1 hour',now()+interval '1 day')`, [invitationId, itemId]);
  return {guestId, itemId, invitationId, serviceId, staffId};
}


test('public review page includes only published originals and visible replies with complete rating totals',async()=>{
 const fixture=await reviewFixture();
 const id=randomUUID();
 await db.query("INSERT INTO app.reviews(id,invitation_id,booking_item_id,primary_guest_id,rating,original_text,original_locale,public_display_name,moderation_state,published_at) VALUES($1,$2,$3,$4,1,'Synthetic critical original','en','S. G.','published',now())",[id,fixture.invitationId,fixture.itemId,fixture.guestId]);
 await db.query("INSERT INTO app.review_replies(review_id,staff_id,body,published_at) VALUES($1,$2,'Published synthetic reply',now()),($1,$2,'Private synthetic draft',NULL)",[id,fixture.staffId]);
 const page=await listReviewPage({serviceId:fixture.serviceId});
 expect(page.summary).toEqual({total:1,average:1,ratings:{1:1,2:0,3:0,4:0,5:0}});
 expect(page.items).toHaveLength(1);expect(page.items[0]).toMatchObject({id,rating:1,text:'Synthetic critical original',display_name:'S. G.',locale:'en',replies:[{body:'Published synthetic reply'}]});
 const filtered=await listReviewPage({serviceId:fixture.serviceId,rating:5});
 expect(filtered.items).toEqual([]);expect(filtered.filteredTotal).toBe(0);expect(filtered.summary.total).toBe(1);
 await db.query("UPDATE app.reviews SET moderation_state='withdrawn' WHERE id=$1",[id]);
 expect(await listReviewPage({serviceId:fixture.serviceId})).toMatchObject({items:[],summary:{total:0,average:null},nextCursor:null});
});
test('review cursor preserves distinct rows sharing the same timestamp',async()=>{
 let serviceId="";const ids:string[]=[];
 for(let index=0;index<3;index++){
  const f=await reviewFixture();
  if(index===0)serviceId=f.serviceId;
  // Use one existing service for all variant joins; each invitation remains independently eligible.
  await db.query('UPDATE app.service_variants SET service_id=$1,variant_code=id::text WHERE service_id=$2',[serviceId,f.serviceId]);
  const id=randomUUID();ids.push(id);
  await db.query("INSERT INTO app.reviews(id,invitation_id,booking_item_id,primary_guest_id,rating,original_text,original_locale,public_display_name,moderation_state,published_at,submitted_at) VALUES($1,$2,$3,$4,4,'Synthetic same-time review','en','S. G.','published',now(),'2026-01-01T00:00:00Z')",[id,f.invitationId,f.itemId,f.guestId]);
 }
 const first=await listReviewPage({serviceId,limit:1});
 const second=await listReviewPage({serviceId,limit:1,cursor:first.nextCursor!});
 const third=await listReviewPage({serviceId,limit:1,cursor:second.nextCursor!});
 expect(new Set([...first.items,...second.items,...third.items].map(item=>item.id))).toEqual(new Set(ids));
 expect(first.summary.total).toBe(3);expect(third.nextCursor).toBeNull();
});
