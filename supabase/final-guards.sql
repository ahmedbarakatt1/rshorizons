ALTER TABLE app.apartment_inventory ADD CONSTRAINT apartment_inventory_finite_dates CHECK(isfinite(lower(date_range)) AND isfinite(upper(date_range)));
ALTER TABLE app.resource_occupancy ADD CONSTRAINT resource_occupancy_finite_times CHECK(isfinite(lower(time_range)) AND isfinite(upper(time_range)));
ALTER TABLE app.price_rules ADD CONSTRAINT price_rules_finite_dates CHECK(isfinite(lower(effective_range)) AND isfinite(upper(effective_range)));
ALTER TABLE app.apartment_rate_rules ADD CONSTRAINT apartment_rates_finite_dates CHECK(isfinite(lower(date_range)) AND isfinite(upper(date_range)));
CREATE FUNCTION app.guard_consent_evidence() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,app AS $$
BEGIN
 IF TG_OP='DELETE' OR ROW(NEW.id,NEW.asset_id,NEW.subject_guest_id,NEW.granted_by_guest_id,NEW.evidence_ref,NEW.allowed_uses,NEW.granted_at,NEW.expires_at,NEW.created_at)
 IS DISTINCT FROM ROW(OLD.id,OLD.asset_id,OLD.subject_guest_id,OLD.granted_by_guest_id,OLD.evidence_ref,OLD.allowed_uses,OLD.granted_at,OLD.expires_at,OLD.created_at)
 OR(OLD.withdrawn_at IS NOT NULL AND NEW.withdrawn_at IS DISTINCT FROM OLD.withdrawn_at) THEN RAISE EXCEPTION 'CONSENT_EVIDENCE_IMMUTABLE' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER consent_evidence_immutable BEFORE UPDATE OR DELETE ON app.publication_consents FOR EACH ROW EXECUTE FUNCTION app.guard_consent_evidence();
CREATE FUNCTION app.fulfil_item_versioned(p_item uuid,p_state text,p_note text,p_expected integer,p_actor uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
DECLARE booking uuid; current_version integer;
BEGIN
 SELECT bi.booking_id INTO booking FROM app.booking_items bi WHERE bi.id=p_item AND bi.superseded_at IS NULL;
 IF booking IS NULL THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 PERFORM app.assert_staff(p_actor,'operations.write',booking);
 SELECT version INTO current_version FROM app.bookings WHERE id=booking FOR UPDATE;
 IF current_version IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'VERSION_CONFLICT';END IF;
 PERFORM app.fulfil_item(p_item,p_state,p_note,p_actor);
END $$;
CREATE FUNCTION app.invite_staff(p_identity uuid,p_email text,p_name text,p_roles text[],p_scopes jsonb,p_actor uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
DECLARE result jsonb;
BEGIN
 PERFORM app.assert_staff(p_actor,'staff.manage');
 IF NOT EXISTS(SELECT 1 FROM app.staff_roles sr JOIN app.roles r ON r.id=sr.role_id WHERE sr.staff_id=p_actor AND r.code='owner') OR NOT app.scope_allows(p_actor,NULL,NULL) THEN RAISE EXCEPTION 'OWNER_REQUIRED' USING ERRCODE='42501';END IF;
 IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_identity AND lower(email)=lower(p_email)) THEN RAISE EXCEPTION 'INVITED_AUTH_IDENTITY_REQUIRED';END IF;
 IF coalesce(cardinality(p_roles),0)=0 OR EXISTS(SELECT 1 FROM unnest(p_roles) AS requested(code) WHERE NOT EXISTS(SELECT 1 FROM app.roles r WHERE r.code=requested.code)) THEN RAISE EXCEPTION 'INVALID_ROLES';END IF;
 IF jsonb_typeof(p_scopes)<>'array' OR jsonb_array_length(p_scopes)=0 THEN RAISE EXCEPTION 'INVALID_SCOPES';END IF;
 result:=app.staff_edit('staff',NULL,NULL,jsonb_build_object('authUserId',p_identity,'name',p_name,'roles',to_jsonb(p_roles),'scopes',p_scopes),p_actor);
 RETURN result||jsonb_build_object('invitationState','pending_activation');
END $$;
REVOKE ALL ON FUNCTION app.guard_consent_evidence(),app.fulfil_item_versioned(uuid,text,text,integer,uuid),app.invite_staff(uuid,text,text,text[],jsonb,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION app.fulfil_item_versioned(uuid,text,text,integer,uuid),app.invite_staff(uuid,text,text,text[],jsonb,uuid) TO tourism_app;
