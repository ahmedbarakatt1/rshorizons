-- Required reference data, independent of synthetic fixtures.
-- No staff account, business price, published content or approval is seeded.
INSERT INTO app.locales(code,direction) SELECT code,CASE WHEN code='ar' THEN 'rtl' ELSE 'ltr' END FROM unnest(ARRAY['en','de','pl','fr','ru','uk','es','ar','it','nl']) code ON CONFLICT DO NOTHING;
INSERT INTO app.currencies(code,exponent,enabled_for_charge,enabled_for_display) VALUES('EGP',2,true,true),('EUR',2,false,true),('USD',2,false,true) ON CONFLICT DO NOTHING;
INSERT INTO app.agency_settings(id,display_name,timezone,default_locale,default_currency,booking_enabled) VALUES(true,'Red Sea Horizons','Africa/Cairo','en','EGP',false) ON CONFLICT DO NOTHING;
INSERT INTO app.roles(code,label) SELECT code,replace(initcap(code),'_',' ') FROM unnest(ARRAY['owner','reservations','operations','property_manager','finance','content_editor','photographer']) code ON CONFLICT DO NOTHING;
INSERT INTO app.permissions(code,description) SELECT code,code FROM unnest(ARRAY['bookings.read','bookings.approve','bookings.cancel','bookings.revise','operations.write','apartments.write','apartments.block','apartments.operate','payments.record_offline','refunds.request','refunds.approve','finance.reconcile','catalog.write','content.write','content.publish','media.upload','media.manage','galleries.manage','reviews.moderate','notifications.read','notifications.retry','reports.read','audit.read','staff.manage']) code ON CONFLICT DO NOTHING;
INSERT INTO app.role_permissions(role_id,permission_id) SELECT r.id,p.id FROM app.roles r CROSS JOIN app.permissions p WHERE r.code='owner' OR
(r.code='reservations' AND p.code=ANY(ARRAY['bookings.read','bookings.approve','bookings.cancel','bookings.revise','refunds.request','notifications.read'])) OR
(r.code='operations' AND p.code=ANY(ARRAY['bookings.read','operations.write'])) OR
(r.code='property_manager' AND p.code=ANY(ARRAY['bookings.read','bookings.approve','apartments.write','apartments.block','apartments.operate','refunds.request'])) OR
(r.code='finance' AND p.code=ANY(ARRAY['payments.record_offline','refunds.request','refunds.approve','finance.reconcile','audit.read','reports.read'])) OR
(r.code='content_editor' AND p.code=ANY(ARRAY['catalog.write','content.write','content.publish','reviews.moderate'])) OR
(r.code='photographer' AND p.code=ANY(ARRAY['media.upload','galleries.manage'])) ON CONFLICT DO NOTHING;
