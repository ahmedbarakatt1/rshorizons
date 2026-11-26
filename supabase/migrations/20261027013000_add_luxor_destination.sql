INSERT INTO app.destinations(id,canonical_slug,active)
VALUES(md5('destination:luxor')::uuid,'luxor',true)
ON CONFLICT(canonical_slug) DO UPDATE SET active=true,updated_at=now();

INSERT INTO app.destination_translations(destination_id,locale,title,slug,description,approved_at)
VALUES
(md5('destination:luxor')::uuid,'en','Luxor','luxor','Ancient temples and Nile-side history in Upper Egypt.',now()),
(md5('destination:luxor')::uuid,'de','Luxor','luxor','Antike Tempel und Geschichte am Nil in Oberägypten.',now()),
(md5('destination:luxor')::uuid,'pl','Luksor','luxor','Starożytne świątynie i historia nad Nilem w Górnym Egipcie.',now()),
(md5('destination:luxor')::uuid,'fr','Louxor','luxor','Temples antiques et histoire au bord du Nil en Haute-Égypte.',now()),
(md5('destination:luxor')::uuid,'ru','Луксор','luxor','Древние храмы и история на берегах Нила в Верхнем Египте.',now()),
(md5('destination:luxor')::uuid,'uk','Луксор','luxor','Стародавні храми та історія на берегах Нілу у Верхньому Єгипті.',now()),
(md5('destination:luxor')::uuid,'es','Lúxor','luxor','Templos antiguos e historia junto al Nilo en el Alto Egipto.',now()),
(md5('destination:luxor')::uuid,'ar','الأقصر','luxor','معابد عريقة وتاريخ على ضفاف النيل في صعيد مصر.',now()),
(md5('destination:luxor')::uuid,'it','Luxor','luxor','Templi antichi e storia lungo il Nilo nell’Alto Egitto.',now()),
(md5('destination:luxor')::uuid,'nl','Luxor','luxor','Oude tempels en geschiedenis langs de Nijl in Opper-Egypte.',now())
ON CONFLICT(destination_id,locale) DO UPDATE SET title=excluded.title,slug=excluded.slug,description=excluded.description,approved_at=excluded.approved_at;
