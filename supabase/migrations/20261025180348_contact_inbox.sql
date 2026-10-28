-- Unassigned inbound messages have no destination scope. Only explicitly
-- authorized staff with global scope can read or resolve them.
INSERT INTO app.permissions(code,description) VALUES
 ('contacts.read','Read the retained contact inbox'),
 ('contacts.manage','Resolve retained contact requests') ON CONFLICT DO NOTHING;
INSERT INTO app.role_permissions(role_id,permission_id)
 SELECT r.id,p.id FROM app.roles r CROSS JOIN app.permissions p
 WHERE r.code='owner' AND p.code IN('contacts.read','contacts.manage') ON CONFLICT DO NOTHING;

CREATE FUNCTION app.update_contact_state(p_id uuid,p_expected integer,p_state text,p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,app AS $$
DECLARE previous app.contact_requests; result jsonb;
BEGIN
 PERFORM app.assert_staff(p_actor,'contacts.manage');
 IF NOT app.scope_allows(p_actor,NULL,NULL) THEN RAISE EXCEPTION 'SCOPE_FORBIDDEN' USING ERRCODE='42501'; END IF;
 SELECT * INTO previous FROM app.contact_requests WHERE id=p_id AND retention_deadline>now() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 IF p_expected IS NULL OR previous.version<>p_expected THEN RAISE EXCEPTION 'VERSION_CONFLICT'; END IF;
 IF p_state IS NULL OR p_state NOT IN('new','replied','closed','spam') THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
 UPDATE app.contact_requests SET state=p_state,version=version+1,updated_at=now() WHERE id=p_id
 RETURNING jsonb_build_object('id',id,'state',state,'version',version) INTO result;
 INSERT INTO app.audit_events(actor_type,actor_id,action,target_type,target_id,summary)
 VALUES('staff',p_actor,'contact_state_changed','contact_request',p_id,jsonb_build_object('from',previous.state,'to',p_state));
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION app.update_contact_state(uuid,integer,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION app.update_contact_state(uuid,integer,text,uuid) TO tourism_app;
