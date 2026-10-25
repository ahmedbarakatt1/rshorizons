import {randomUUID} from "node:crypto";
import {afterAll,beforeAll,expect,test,vi} from "vitest";
import {admin} from "../database/helpers";
import {query} from "@/server/db";
import {cleanupExpiredContacts} from "@/modules/content/contact-retention";
const db=admin();beforeAll(()=>db.connect());afterAll(()=>db.end());
test("contact cleanup erases only expired PII in bounded audited batches after retention approval",async()=>{
 const ids=[randomUUID(),randomUUID(),randomUUID()];
 await db.query(`INSERT INTO app.contact_requests(id,sender_name,email,locale,message,consent_metadata,created_at,retention_deadline)
  SELECT id,'Synthetic expired contact','expired@example.invalid','en','Private enquiry content','{}',now()-interval '4 days',CASE WHEN id=$2::uuid THEN now()+interval '1 day' ELSE now()-interval '2 days' END FROM unnest($1::uuid[]) id`,[ids,ids[2]]);
 try{
  vi.stubEnv("RETENTION_POLICY_APPROVED","false");const dry=await cleanupExpiredContacts({dryRun:true,limit:1000});expect(dry.eligibleIds).toEqual(expect.arrayContaining(ids.slice(0,2)));expect(dry.purgedIds).toEqual([]);
  await expect(cleanupExpiredContacts({dryRun:false,limit:1000})).rejects.toThrow("RETENTION_POLICY_UNAPPROVED");
  vi.stubEnv("RETENTION_POLICY_APPROVED","true");const bounded=await cleanupExpiredContacts({dryRun:false,limit:1});expect(bounded.purgedIds).toHaveLength(1);
  const rest=await cleanupExpiredContacts({dryRun:false,limit:1000});expect([...bounded.purgedIds,...rest.purgedIds]).toEqual(expect.arrayContaining(ids.slice(0,2)));
  expect((await db.query("SELECT id FROM app.contact_requests WHERE id=ANY($1::uuid[])",[ids])).rows).toEqual([{id:ids[2]}]);
  const audit=(await db.query("SELECT summary FROM app.audit_events WHERE action='contact_retention_purged' AND target_id=ANY($1::uuid[])",[ids])).rows;expect(audit).toHaveLength(2);expect(JSON.stringify(audit)).not.toMatch(/expired@example|Private enquiry|Synthetic expired/);
  expect((await query("DELETE FROM app.contact_requests WHERE id=$1",[ids[2]])).rowCount).toBe(0);
 }finally{vi.unstubAllEnvs();await db.query("DELETE FROM app.contact_requests WHERE id=ANY($1::uuid[])",[ids]);}
});
