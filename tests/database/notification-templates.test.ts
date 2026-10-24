import {afterAll,beforeAll,expect,it} from "vitest";
import {randomUUID} from "node:crypto";
import {admin} from "./helpers";
const db=admin();beforeAll(()=>db.connect());afterAll(()=>db.end());
async function draft(){return (await db.query(`INSERT INTO app.notification_templates(event_type,channel,locale,template_version,provider,approval_status,category,body_template)
 VALUES($1,'whatsapp','en',1,'openwa','draft','utility','Original {{reference}}') RETURNING id`,[randomUUID()])).rows[0].id;}
it("approved text and identity cannot be rewritten even after disabling",async()=>{
 const id=await draft();await db.query("UPDATE app.notification_templates SET approval_status='approved' WHERE id=$1",[id]);
 await expect(db.query("UPDATE app.notification_templates SET body_template='Changed without approval' WHERE id=$1",[id])).rejects.toThrow("APPROVED_TEMPLATE_IMMUTABLE");
 await db.query("UPDATE app.notification_templates SET approval_status='disabled',version=version+1 WHERE id=$1",[id]);
 await expect(db.query("UPDATE app.notification_templates SET provider='meta',provider_template_id='changed',provider_language='en' WHERE id=$1",[id])).rejects.toThrow("APPROVED_TEMPLATE_IMMUTABLE");
 await expect(db.query("UPDATE app.notification_templates SET approval_status='draft',body_template='Changed' WHERE id=$1",[id])).rejects.toThrow("APPROVED_TEMPLATE_IMMUTABLE");
 await expect(db.query("DELETE FROM app.notification_templates WHERE id=$1",[id])).rejects.toThrow("APPROVED_TEMPLATE_IMMUTABLE");
});
it("draft text can be edited then approval permanently freezes its content",async()=>{
 const id=await draft();await db.query("UPDATE app.notification_templates SET body_template='Approved wording {{reference}}' WHERE id=$1",[id]);
 await db.query("UPDATE app.notification_templates SET approval_status='approved' WHERE id=$1",[id]);
 await db.query("UPDATE app.notification_templates SET approval_status='paused' WHERE id=$1",[id]);
 await db.query("UPDATE app.notification_templates SET approval_status='approved' WHERE id=$1",[id]);
 await expect(db.query("UPDATE app.notification_templates SET template_version=2 WHERE id=$1",[id])).rejects.toThrow("APPROVED_TEMPLATE_IMMUTABLE");
});
