GRANT EXECUTE ON FUNCTION app.assert_staff(uuid,text,uuid) TO tourism_app;
GRANT INSERT ON app.outbox_events,app.audit_events,app.booking_events TO tourism_app;
DROP POLICY IF EXISTS runtime_insert ON app.outbox_events;
CREATE POLICY runtime_insert ON app.outbox_events FOR INSERT TO tourism_app WITH CHECK(true);
DROP POLICY IF EXISTS runtime_insert ON app.audit_events;
CREATE POLICY runtime_insert ON app.audit_events FOR INSERT TO tourism_app WITH CHECK(true);
DROP POLICY IF EXISTS runtime_insert ON app.booking_events;
CREATE POLICY runtime_insert ON app.booking_events FOR INSERT TO tourism_app WITH CHECK(true);
