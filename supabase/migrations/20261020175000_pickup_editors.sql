ALTER TABLE app.pickup_locations ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK(version>0);
ALTER TABLE app.variant_pickups ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE;
ALTER TABLE app.variant_pickups ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK(version>0);
CREATE FUNCTION app.edit_pickup(p_kind text,p_id uuid,p_expected integer,p_data jsonb,p_actor uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
DECLARE target uuid:=coalesce(p_id,gen_random_uuid()); old jsonb; result jsonb; destination uuid; pickup_destination uuid; variant uuid; pickup uuid;
BEGIN
 PERFORM app.assert_staff(p_actor,'catalog.write');
 IF p_kind NOT IN('pickup_locations','variant_pickups') THEN RAISE EXCEPTION 'INVALID_EDITOR';END IF;
 IF p_id IS NOT NULL THEN
  EXECUTE format('SELECT to_jsonb(t) FROM app.%I t WHERE id=$1 FOR UPDATE',p_kind) INTO old USING p_id;
  IF old IS NULL THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
  IF p_expected IS DISTINCT FROM (old->>'version')::int THEN RAISE EXCEPTION 'VERSION_CONFLICT';END IF;
 END IF;
 IF p_kind='pickup_locations' THEN
  destination:=coalesce((p_data->>'destinationId')::uuid,(old->>'destination_id')::uuid);
  IF destination IS NULL OR NOT app.scope_allows(p_actor,destination,NULL) OR (old IS NOT NULL AND NOT app.scope_allows(p_actor,(old->>'destination_id')::uuid,NULL)) THEN RAISE EXCEPTION 'SCOPE_FORBIDDEN' USING ERRCODE='42501';END IF;
  IF old IS NOT NULL AND destination<>(old->>'destination_id')::uuid THEN RAISE EXCEPTION 'PARENT_CHANGE_FORBIDDEN';END IF;
  IF p_id IS NULL THEN
   INSERT INTO app.pickup_locations(id,destination_id,name,address,latitude,longitude,active) VALUES(target,destination,p_data->>'name',p_data->>'address',(p_data->>'latitude')::numeric,(p_data->>'longitude')::numeric,coalesce((p_data->>'active')::boolean,true));
  ELSE UPDATE app.pickup_locations SET name=coalesce(p_data->>'name',name),address=coalesce(p_data->>'address',address),latitude=coalesce((p_data->>'latitude')::numeric,latitude),longitude=coalesce((p_data->>'longitude')::numeric,longitude),active=coalesce((p_data->>'active')::boolean,active),version=version+1 WHERE id=target;
  END IF;
 ELSE
  variant:=coalesce((p_data->>'variantId')::uuid,(old->>'variant_id')::uuid);
  pickup:=coalesce((p_data->>'pickupId')::uuid,(old->>'pickup_id')::uuid);
  IF old IS NOT NULL AND (variant<>(old->>'variant_id')::uuid OR pickup<>(old->>'pickup_id')::uuid) THEN RAISE EXCEPTION 'PARENT_CHANGE_FORBIDDEN';END IF;
  SELECT s.destination_id INTO destination FROM app.service_variants v JOIN app.services s ON s.id=v.service_id WHERE v.id=variant;
  SELECT destination_id INTO pickup_destination FROM app.pickup_locations WHERE id=pickup;
  IF destination IS NULL OR pickup_destination IS DISTINCT FROM destination THEN RAISE EXCEPTION 'PICKUP_DESTINATION_MISMATCH';END IF;
  IF NOT app.scope_allows(p_actor,destination,NULL) THEN RAISE EXCEPTION 'SCOPE_FORBIDDEN' USING ERRCODE='42501';END IF;
  IF coalesce((p_data->>'offsetMinutes')::int,0) NOT BETWEEN -1440 AND 1440 THEN RAISE EXCEPTION 'INVALID_BUFFER';END IF;
  IF p_id IS NULL THEN
   INSERT INTO app.variant_pickups(id,variant_id,pickup_id,surcharge,currency,offset_minutes) VALUES(target,variant,pickup,(p_data->>'surchargeAmountMinor')::bigint,p_data->>'currency',coalesce((p_data->>'offsetMinutes')::int,0));
  ELSE UPDATE app.variant_pickups SET surcharge=coalesce((p_data->>'surchargeAmountMinor')::bigint,surcharge),currency=coalesce(p_data->>'currency',currency),offset_minutes=coalesce((p_data->>'offsetMinutes')::int,offset_minutes),version=version+1 WHERE id=target;
  END IF;
 END IF;
 EXECUTE format('SELECT to_jsonb(t) FROM app.%I t WHERE id=$1',p_kind) INTO result USING target;
 INSERT INTO app.audit_events(actor_type,actor_id,action,target_type,target_id) VALUES('staff',p_actor,'pickup_edited',p_kind,target);
 RETURN app.money_json(result);
END $$;
REVOKE ALL ON FUNCTION app.edit_pickup(text,uuid,integer,jsonb,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION app.edit_pickup(text,uuid,integer,jsonb,uuid) TO tourism_app;
