import {query} from "@/server/db";
/** Read-only launch checks. Flags are not a substitute for persisted content approval. */
export async function productionDataProblems(){
 const {rows}=await query(`SELECT
  (SELECT rolname FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) AS privileged_role,
  NOT EXISTS(SELECT 1 FROM app.agency_settings WHERE id AND length(legal_name)>1 AND content_approved_at IS NOT NULL) AS identity_unapproved,
  EXISTS(SELECT 1 FROM app.services WHERE synthetic) OR EXISTS(SELECT 1 FROM app.apartments WHERE synthetic) OR EXISTS(SELECT 1 FROM app.guests WHERE email LIKE '%.invalid') AS synthetic_records,
  EXISTS(SELECT 1 FROM app.local_operator_sessions WHERE revoked_at IS NULL AND expires_at>now()) AS local_operator_sessions,
  NOT EXISTS(SELECT 1 FROM app.staff_profiles sp JOIN app.staff_roles sr ON sr.staff_id=sp.id JOIN app.roles r ON r.id=sr.role_id WHERE sp.active AND sp.revoked_at IS NULL AND sp.mfa_required AND r.code='owner') AS owner_missing,
  EXISTS(SELECT 1 FROM app.services s CROSS JOIN app.locales l WHERE s.status='published' AND l.enabled AND NOT EXISTS(SELECT 1 FROM app.service_translations t WHERE t.service_id=s.id AND t.locale=l.code AND t.approved_at IS NOT NULL)) AS service_translations_missing,
  EXISTS(SELECT 1 FROM app.service_variants v JOIN app.services s ON s.id=v.service_id CROSS JOIN app.locales l WHERE v.active AND s.status='published' AND l.enabled AND NOT EXISTS(SELECT 1 FROM app.variant_translations t WHERE t.variant_id=v.id AND t.locale=l.code AND t.approved_at IS NOT NULL)) AS variant_translations_missing,
  EXISTS(SELECT 1 FROM app.apartments a CROSS JOIN app.locales l WHERE a.status='active' AND l.enabled AND NOT EXISTS(SELECT 1 FROM app.apartment_translations t WHERE t.apartment_id=a.id AND t.locale=l.code AND t.approved_at IS NOT NULL)) AS apartment_translations_missing,
  EXISTS(SELECT 1 FROM app.locales l CROSS JOIN unnest(ARRAY['terms','privacy','cancellation']) p(type) WHERE l.enabled AND NOT EXISTS(SELECT 1 FROM app.policy_versions v WHERE v.policy_type=p.type AND v.locale=l.code AND v.approved_at IS NOT NULL AND v.effective_at<=now())) AS critical_policies_missing,
  NOT EXISTS(SELECT 1 FROM app.payment_policies WHERE approved_at IS NOT NULL) AS payment_policy_missing,
  EXISTS(SELECT 1 FROM app.media_assets WHERE classification='public' AND (rights_evidence_ref IS NULL OR subjects_reviewed_at IS NULL)) AS media_approval_missing`);
 const checks=rows[0] as Record<string,unknown>;
 return Object.entries(checks).filter(([,value])=>!!value).map(([name])=>name);
}
