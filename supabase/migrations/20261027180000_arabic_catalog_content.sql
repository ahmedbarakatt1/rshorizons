-- Replace the English showcase placeholders that were copied into the Arabic
-- locale. Slugs and product identifiers remain stable; only public copy changes.

UPDATE app.destination_translations t
SET title=CASE d.canonical_slug
    WHEN 'marsa-alam' THEN 'مرسى علم'
    WHEN 'al-qusair' THEN 'القصير'
    WHEN 'hurghada' THEN 'الغردقة'
    WHEN 'port-ghalib' THEN 'بورت غالب'
    WHEN 'luxor' THEN 'الأقصر'
    ELSE t.title
  END,
  description=CASE d.canonical_slug
    WHEN 'marsa-alam' THEN 'وجهة هادئة على البحر الأحمر للرحلات البحرية واستكشاف الشعاب.'
    WHEN 'al-qusair' THEN 'مدينة ساحلية على البحر الأحمر تجمع بين الشاطئ والطابع التاريخي.'
    WHEN 'hurghada' THEN 'وجهة على البحر الأحمر للرحلات البحرية والأنشطة الصحراوية.'
    WHEN 'port-ghalib' THEN 'مرسى ووجهة ساحلية بالقرب من مرسى علم.'
    WHEN 'luxor' THEN 'معابد عريقة وتاريخ على ضفاف النيل في صعيد مصر.'
    ELSE t.description
  END,
  approved_at=now()
FROM app.destinations d
WHERE t.destination_id=d.id AND t.locale='ar';

UPDATE app.category_translations t
SET label=CASE c.code
    WHEN 'tours' THEN 'الرحلات'
    WHEN 'boat_tours' THEN 'الرحلات البحرية'
    WHEN 'scuba_diving' THEN 'الغوص'
    WHEN 'shore_dives' THEN 'الغوص من الشاطئ'
    WHEN 'snorkeling' THEN 'السنوركلينج'
    WHEN 'desert_safari' THEN 'رحلات السفاري الصحراوية'
    WHEN 'beach_buggy' THEN 'الباجي الشاطئي'
    WHEN 'transportation' THEN 'خدمات الانتقال'
    WHEN 'photography' THEN 'التصوير'
    ELSE t.label
  END,
  description='فئة من خدمات ريد سي هورايزنز'
FROM app.categories c
WHERE t.category_id=c.id AND t.locale='ar';

UPDATE app.service_translations t
SET title=CASE c.code
    WHEN 'tours' THEN 'استكشاف البحر الأحمر'
    WHEN 'boat_tours' THEN 'يوم في البحر المفتوح'
    WHEN 'scuba_diving' THEN 'استكشف عالم ما تحت السطح'
    WHEN 'shore_dives' THEN 'تجربة غوص من الشاطئ'
    WHEN 'snorkeling' THEN 'سنوركلينج فوق الشعاب المرجانية'
    WHEN 'desert_safari' THEN 'الصحراء وقت الغروب'
    WHEN 'beach_buggy' THEN 'مغامرة باجي على المسارات الساحلية'
    WHEN 'transportation' THEN 'انتقال خاص في البحر الأحمر'
    WHEN 'photography' THEN 'جلسة تصوير تحت الماء'
    ELSE t.title
  END,
  summary='تجربة معروضة للتعريف بالخدمة. يؤكد فريق خدمة العملاء التفاصيل والسعر ومتطلبات التشغيل قبل الحجز.',
  itinerary=jsonb_build_array('لقاء الفريق','التعريف بالنشاط','تنفيذ التجربة المتفق عليها','العودة'),
  inclusions=jsonb_build_array('الخدمات التي يؤكدها فريق خدمة العملاء ضمن العرض النهائي'),
  exclusions=jsonb_build_array('أي خدمات غير مذكورة في العرض النهائي'),
  meeting_notes='يتم تنسيق نقطة اللقاء أو الاستلام مع خدمة العملاء.',
  approved_at=now()
FROM app.services s
JOIN app.categories c ON c.id=s.category_id
WHERE t.service_id=s.id AND t.locale='ar';

UPDATE app.variant_translations t
SET title=CASE WHEN v.variant_code='shared' THEN 'انتقال مشترك' ELSE 'التجربة الأساسية' END,
  description=CASE WHEN v.variant_code='shared'
    THEN 'انتقال مشترك حسب المسار والموعد اللذين تؤكدهما خدمة العملاء.'
    ELSE 'الخيار الأساسي للخدمة حسب التفاصيل التي يؤكدها فريق خدمة العملاء.'
  END,
  approved_at=now()
FROM app.service_variants v
WHERE t.variant_id=v.id AND t.locale='ar';

UPDATE app.apartment_translations t
SET title=CASE a.unit_code
    WHEN 'DEMO-1' THEN 'استوديو المارينا'
    WHEN 'DEMO-2' THEN 'شقة الميناء'
    ELSE 'إقامة ساحلية للعائلات'
  END,
  description='وحدة إقامة معروضة ضمن فئة الشقق. يؤكد فريق خدمة العملاء التفاصيل الفعلية والصور والتوفر قبل الحجز.',
  house_rules=jsonb_build_array('تأكيد تفاصيل الوحدة مع خدمة العملاء','لا يتم تأكيد الحجز إلا بعد موافقة الفريق'),
  approved_at=now()
FROM app.apartments a
WHERE t.apartment_id=a.id AND t.locale='ar';

UPDATE app.amenity_translations t
SET label=CASE a.code
    WHEN 'wifi' THEN 'واي فاي'
    WHEN 'kitchen' THEN 'مطبخ'
    WHEN 'air_conditioning' THEN 'تكييف هواء'
    ELSE t.label
  END
FROM app.amenities a
WHERE t.amenity_id=a.id AND t.locale='ar';
