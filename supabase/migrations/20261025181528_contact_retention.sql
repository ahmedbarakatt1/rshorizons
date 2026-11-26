-- Server-only cleanup may delete expired enquiries, never active contacts.
-- The application additionally requires explicit retention-policy approval.
GRANT DELETE ON app.contact_requests TO tourism_app;
CREATE POLICY runtime_expired_delete ON app.contact_requests FOR DELETE TO tourism_app
 USING (retention_deadline<=now());
