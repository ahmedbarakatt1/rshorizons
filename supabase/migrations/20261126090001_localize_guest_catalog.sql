-- Refresh only known showcase text. Staff-authored fields and approval timestamps
-- are independent, and neither a translation nor a change of language grants approval.
-- Destination IDs and category IDs have no synthetic flag, so match the original
-- seed IDs and field values. Retired services and their historical variants are excluded.
WITH original(code, title_en, title_ar, category_ar) AS (VALUES
  ('tours', 'Red Sea discovery', 'استكشاف البحر الأحمر', 'الرحلات'),
  ('boat_tours', 'Day on the open sea', 'يوم في البحر المفتوح', 'الرحلات البحرية'),
  ('scuba_diving', 'Explore beneath the surface', 'استكشف عالم ما تحت السطح', 'الغوص'),
  ('snorkeling', 'Reef snorkeling', 'سنوركلينج فوق الشعاب المرجانية', 'السنوركلينج'),
  ('desert_safari', 'Desert at golden hour', 'الصحراء وقت الغروب', 'رحلات السفاري الصحراوية'),
  ('beach_buggy', 'Coastal buggy trail', 'مغامرة باجي على المسارات الساحلية', 'الباجي الشاطئي'),
  ('transportation', 'Private Red Sea transfer', 'انتقال خاص في البحر الأحمر', 'خدمات الانتقال')
), offers(locale, code, title, summary, category_label) AS (VALUES
  ('en', 'tours', 'Red Sea outing from Marsa Alam', 'Plan an outing along the Red Sea coast. Tell us what you’d like to see around Marsa Alam.', 'Coastal tours'),
  ('en', 'boat_tours', 'Boat trip from Marsa Alam', 'Spend the day on the Red Sea. Ask us about the boat route and departure time for your date.', 'Boat trips'),
  ('en', 'scuba_diving', 'Scuba diving in Marsa Alam', 'Explore the Red Sea below the surface. Tell us about your diving experience so we can discuss a suitable dive.', 'Scuba diving'),
  ('en', 'snorkeling', 'Reef snorkeling in Marsa Alam', 'See the reef from the surface with a mask and snorkel. We’ll confirm the site and what to bring.', 'Snorkeling'),
  ('en', 'desert_safari', 'Hurghada desert safari at sunset', 'Head into the desert near Hurghada in the late afternoon. Ask us about the route and timing for sunset.', 'Desert safaris'),
  ('en', 'beach_buggy', 'Coastal buggy ride in Hurghada', 'Ride a buggy on the coastal trails near Hurghada. We’ll go over the route and riding requirements with you.', 'Buggy rides'),
  ('en', 'transportation', 'Red Sea transfers', 'Tell us your pickup point, destination and travel date. We’ll check private and shared transfer options for your route.', 'Transfers'),
  ('ar', 'tours', 'فسحة على ساحل البحر الأحمر من مرسى علم', 'نفسك تشوف إيه حوالين مرسى علم؟ قول لنا عشان نرتب معاك فسحة على ساحل البحر الأحمر.', 'رحلات على الساحل'),
  ('ar', 'boat_tours', 'يوم في البحر من مرسى علم', 'اقضِ يومك على مركب في البحر الأحمر. اسألنا عن خط السير ومعاد التحرك في اليوم اللي يناسبك.', 'رحلات بحرية'),
  ('ar', 'scuba_diving', 'غوص في مرسى علم', 'اكتشف البحر الأحمر من تحت الميّه. قول لنا غطست قبل كده ولا دي أول مرة، ونشوف معاك الغطسة المناسبة.', 'غوص'),
  ('ar', 'snorkeling', 'سنوركلينج عند شعاب مرسى علم', 'البس الماسك والسنوركل وشوف الشعاب من على سطح الميّه. هنقول لك هننزل فين وإيه اللي تجيبه معاك.', 'سنوركلينج'),
  ('ar', 'desert_safari', 'سفاري وقت الغروب في الغردقة', 'اطلع الصحرا حوالين الغردقة آخر النهار. اسألنا هنمشي منين ونتحرك إمتى عشان نلحق الغروب.', 'سفاري في الصحرا'),
  ('ar', 'beach_buggy', 'جولة بيتش باجي على ساحل الغردقة', 'لف بالبيتش باجي على الدروب القريبة من ساحل الغردقة. هنراجع معاك الطريق وشروط السواقة قبل ما تطلع.', 'جولات بيتش باجي'),
  ('ar', 'transportation', 'توصيلات على ساحل البحر الأحمر', 'قول لنا هنقابلك فين، ورايح فين، ويوم إيه. هنشوف معاك لو فيه عربية خاصة أو توصيلة مشتركة على نفس الطريق.', 'توصيلات'),
  ('de', 'tours', 'Küstenausflug ab Marsa Alam', 'Was möchten Sie rund um Marsa Alam sehen? Gemeinsam planen wir Ihren Ausflug an der Küste des Roten Meeres.', 'Küstenausflüge'),
  ('de', 'boat_tours', 'Bootsausflug ab Marsa Alam', 'Verbringen Sie einen Tag auf dem Roten Meer. Fragen Sie uns nach der Route und der Abfahrtszeit an Ihrem Wunschtermin.', 'Bootsausflüge'),
  ('de', 'scuba_diving', 'Tauchen in Marsa Alam', 'Entdecken Sie das Rote Meer unter Wasser. Erzählen Sie uns von Ihrer Taucherfahrung, damit wir einen passenden Tauchgang besprechen können.', 'Tauchen'),
  ('de', 'snorkeling', 'Schnorcheln am Riff bei Marsa Alam', 'Beobachten Sie das Riff mit Maske und Schnorchel von der Wasseroberfläche aus. Wir klären mit Ihnen, wo es ins Wasser geht und was Sie mitbringen sollten.', 'Schnorcheln'),
  ('de', 'desert_safari', 'Wüstensafari bei Sonnenuntergang in Hurghada', 'Am späten Nachmittag geht es in die Wüste bei Hurghada. Fragen Sie uns nach der Route und der passenden Uhrzeit für den Sonnenuntergang.', 'Wüstensafaris'),
  ('de', 'beach_buggy', 'Buggytour an der Küste von Hurghada', 'Mit dem Buggy geht es über die Küstenpisten bei Hurghada. Wir besprechen mit Ihnen die Route und die Voraussetzungen für die Fahrt.', 'Buggytouren'),
  ('de', 'transportation', 'Transfers am Roten Meer', 'Nennen Sie uns Abholort, Ziel und Reisedatum. Wir prüfen, ob für Ihre Strecke ein Privat- oder Sammeltransfer möglich ist.', 'Transfers'),
  ('fr', 'tours', 'Balade sur la côte au départ de Marsa Alam', 'Qu’aimeriez-vous découvrir autour de Marsa Alam ? Parlons de vos envies pour préparer votre sortie sur la côte de la mer Rouge.', 'Balades sur la côte'),
  ('fr', 'boat_tours', 'Journée en bateau au départ de Marsa Alam', 'Passez une journée en mer Rouge. Demandez-nous quel itinéraire et quel horaire de départ sont prévus à la date de votre choix.', 'Sorties en bateau'),
  ('fr', 'scuba_diving', 'Plongée sous-marine à Marsa Alam', 'Découvrez la mer Rouge sous la surface. Parlez-nous de votre expérience en plongée pour que nous puissions envisager une sortie adaptée.', 'Plongée sous-marine'),
  ('fr', 'snorkeling', 'Balade avec masque et tuba sur le récif de Marsa Alam', 'Avec un masque et un tuba, observez le récif depuis la surface. Nous vous préciserons le lieu de la sortie et ce qu’il faut apporter.', 'Randonnée palmée'),
  ('fr', 'desert_safari', 'Safari dans le désert au coucher du soleil à Hurghada', 'Partez en fin d’après-midi dans le désert près de Hurghada. Renseignez-vous sur le parcours et l’heure de départ pour le coucher du soleil.', 'Safaris dans le désert'),
  ('fr', 'beach_buggy', 'Balade en buggy sur la côte de Hurghada', 'Parcourez les pistes côtières près de Hurghada en buggy. Nous vous expliquerons le parcours et les conditions de conduite.', 'Balades en buggy'),
  ('fr', 'transportation', 'Transferts sur la mer Rouge', 'Indiquez-nous votre point de départ, votre destination et votre date de voyage. Nous vérifierons les possibilités de transfert privé ou partagé sur ce trajet.', 'Transferts'),
  ('pl', 'tours', 'Wycieczka wzdłuż wybrzeża z Marsa Alam', 'Co chcesz zobaczyć w okolicy Marsa Alam? Pomożemy Ci zaplanować wycieczkę wzdłuż wybrzeża Morza Czerwonego.', 'Wycieczki po wybrzeżu'),
  ('pl', 'boat_tours', 'Rejs z Marsa Alam', 'Spędź dzień na Morzu Czerwonym. Zapytaj o trasę rejsu i godzinę wypłynięcia w wybranym terminie.', 'Rejsy'),
  ('pl', 'scuba_diving', 'Nurkowanie w Marsa Alam', 'Odkryj podwodny świat Morza Czerwonego. Opowiedz nam o swoim doświadczeniu, a wspólnie omówimy odpowiedni dla Ciebie program nurkowania.', 'Nurkowanie z butlą'),
  ('pl', 'snorkeling', 'Snorkeling przy rafie w Marsa Alam', 'Obserwuj rafę z powierzchni wody z maską i rurką. Potwierdzimy miejsce i podpowiemy, co zabrać ze sobą.', 'Snorkeling'),
  ('pl', 'desert_safari', 'Safari na pustyni o zachodzie słońca w Hurghadzie', 'Późnym popołudniem rusz na pustynię w okolicy Hurghady. Zapytaj o trasę i godzinę wyjazdu na zachód słońca.', 'Safari na pustyni'),
  ('pl', 'beach_buggy', 'Przejażdżka buggy wzdłuż wybrzeża Hurghady', 'Przejedź się buggy po nadmorskich szlakach w okolicy Hurghady. Omówimy z Tobą trasę i warunki prowadzenia pojazdu.', 'Przejażdżki buggy'),
  ('pl', 'transportation', 'Transfery nad Morzem Czerwonym', 'Podaj miejsce odbioru, cel podróży i datę. Sprawdzimy, czy na Twojej trasie można zarezerwować przejazd prywatny lub wspólny.', 'Transfery'),
  ('ru', 'tours', 'Прогулка по побережью из Марса-Алама', 'Что вам хотелось бы увидеть в окрестностях Марса-Алама? Расскажите нам, и мы обсудим маршрут вдоль побережья Красного моря.', 'Поездки по побережью'),
  ('ru', 'boat_tours', 'Морская прогулка из Марса-Алама', 'Проведите день на Красном море. Уточните у нас маршрут и время выхода в море на выбранную дату.', 'Морские прогулки'),
  ('ru', 'scuba_diving', 'Дайвинг в Марса-Аламе', 'Познакомьтесь с подводным миром Красного моря. Расскажите о своём опыте погружений, и мы обсудим подходящий вариант.', 'Дайвинг'),
  ('ru', 'snorkeling', 'Снорклинг у рифа в Марса-Аламе', 'Рассмотрите риф с поверхности воды в маске и с трубкой. Мы уточним место и подскажем, что взять с собой.', 'Снорклинг'),
  ('ru', 'desert_safari', 'Сафари в пустыне на закате в Хургаде', 'Ближе к вечеру отправляйтесь в пустыню недалеко от Хургады. Уточните у нас маршрут и время выезда к закату.', 'Сафари в пустыне'),
  ('ru', 'beach_buggy', 'Поездка на багги вдоль побережья Хургады', 'Прокатитесь на багги по прибрежным трассам в окрестностях Хургады. Мы расскажем о маршруте и требованиях к водителю.', 'Поездки на багги'),
  ('ru', 'transportation', 'Трансферы на побережье Красного моря', 'Укажите место подачи, пункт назначения и дату. Мы уточним, доступен ли на вашем маршруте индивидуальный или групповой трансфер.', 'Трансферы'),
  ('uk', 'tours', 'Подорож узбережжям із Марса-Алама', 'Що ви хотіли б побачити поблизу Марса-Алама? Розкажіть нам, і ми разом сплануємо поїздку узбережжям Червоного моря.', 'Поїздки узбережжям'),
  ('uk', 'boat_tours', 'Морська прогулянка з Марса-Алама', 'Проведіть день на Червоному морі. Запитайте нас про маршрут і час виходу в море на обрану дату.', 'Морські прогулянки'),
  ('uk', 'scuba_diving', 'Дайвінг у Марса-Аламі', 'Відкрийте для себе підводний світ Червоного моря. Розкажіть про свій досвід, і ми обговоримо занурення, яке вам підійде.', 'Дайвінг'),
  ('uk', 'snorkeling', 'Снорклінг біля рифу в Марса-Аламі', 'Роздивіться риф із поверхні води в масці з трубкою. Ми уточнимо місце та підкажемо, що взяти із собою.', 'Снорклінг'),
  ('uk', 'desert_safari', 'Сафарі в пустелі на заході сонця в Хургаді', 'Надвечір вирушайте в пустелю поблизу Хургади. Запитайте про маршрут і час виїзду, щоб побачити захід сонця.', 'Сафарі в пустелі'),
  ('uk', 'beach_buggy', 'Поїздка на багі узбережжям Хургади', 'Прокатайтеся на багі прибережними трасами поблизу Хургади. Ми розповімо про маршрут і вимоги до водія.', 'Поїздки на багі'),
  ('uk', 'transportation', 'Трансфери на узбережжі Червоного моря', 'Вкажіть місце подачі, пункт призначення й дату. Ми перевіримо, чи є на вашому маршруті індивідуальний або спільний трансфер.', 'Трансфери'),
  ('es', 'tours', 'Excursión por la costa desde Marsa Alam', '¿Qué te gustaría ver por los alrededores de Marsa Alam? Cuéntanoslo y prepararemos contigo la salida por la costa del mar Rojo.', 'Excursiones por la costa'),
  ('es', 'boat_tours', 'Día en barco desde Marsa Alam', 'Pasa un día navegando por el mar Rojo. Pregúntanos por la ruta y la hora de salida para la fecha que tienes en mente.', 'Salidas en barco'),
  ('es', 'scuba_diving', 'Buceo en Marsa Alam', 'Descubre el mar Rojo bajo la superficie. Cuéntanos qué experiencia tienes para que podamos hablar de una inmersión adecuada para ti.', 'Buceo'),
  ('es', 'snorkeling', 'Esnórquel en el arrecife de Marsa Alam', 'Observa el arrecife desde la superficie con máscara y tubo. Te confirmaremos el lugar y te diremos qué llevar.', 'Esnórquel'),
  ('es', 'desert_safari', 'Safari por el desierto al atardecer en Hurghada', 'Adéntrate en el desierto cerca de Hurghada a última hora de la tarde. Consúltanos la ruta y la hora de salida para ver la puesta de sol.', 'Safaris por el desierto'),
  ('es', 'beach_buggy', 'Ruta en buggy por la costa de Hurghada', 'Recorre en buggy las pistas costeras de los alrededores de Hurghada. Te explicaremos la ruta y los requisitos para conducir.', 'Rutas en buggy'),
  ('es', 'transportation', 'Traslados en el mar Rojo', 'Indícanos el punto de recogida, el destino y la fecha. Comprobaremos qué opciones de traslado privado o compartido hay para tu trayecto.', 'Traslados'),
  ('it', 'tours', 'Escursione lungo la costa da Marsa Alam', 'Che cosa vorresti vedere nei dintorni di Marsa Alam? Raccontacelo e organizzeremo insieme la tua uscita lungo la costa del Mar Rosso.', 'Escursioni lungo la costa'),
  ('it', 'boat_tours', 'Giornata in barca da Marsa Alam', 'Trascorri una giornata in barca sul Mar Rosso. Chiedici quale itinerario e quale orario di partenza sono previsti per la data che preferisci.', 'Gite in barca'),
  ('it', 'scuba_diving', 'Immersioni a Marsa Alam', 'Esplora il Mar Rosso sotto la superficie. Raccontaci la tua esperienza subacquea per valutare insieme un’immersione adatta a te.', 'Immersioni'),
  ('it', 'snorkeling', 'Snorkeling sulla barriera corallina di Marsa Alam', 'Osserva la barriera corallina dalla superficie con maschera e boccaglio. Ti confermeremo il luogo dell’uscita e cosa portare.', 'Snorkeling'),
  ('it', 'desert_safari', 'Safari nel deserto al tramonto a Hurghada', 'Nel tardo pomeriggio parti alla scoperta del deserto nei dintorni di Hurghada. Chiedici informazioni sul percorso e sull’orario di partenza per il tramonto.', 'Safari nel deserto'),
  ('it', 'beach_buggy', 'Giro in buggy sulla costa di Hurghada', 'Percorri in buggy le piste costiere nei dintorni di Hurghada. Ti spiegheremo il percorso e i requisiti per la guida.', 'Giri in buggy'),
  ('it', 'transportation', 'Trasferimenti sul Mar Rosso', 'Indicaci il punto di partenza, la destinazione e la data. Verificheremo le opzioni di trasferimento privato o condiviso per il tuo tragitto.', 'Trasferimenti'),
  ('nl', 'tours', 'Kusttocht vanuit Marsa Alam', 'Wat zou je rond Marsa Alam willen zien? Vertel het ons, dan plannen we samen je uitstapje langs de Rode Zee.', 'Kusttochten'),
  ('nl', 'boat_tours', 'Dagtocht per boot vanuit Marsa Alam', 'Breng een dag op de Rode Zee door. Vraag ons naar de vaarroute en de vertrektijd op de dag die je op het oog hebt.', 'Boottochten'),
  ('nl', 'scuba_diving', 'Duiken bij Marsa Alam', 'Ontdek de Rode Zee onder water. Vertel ons over je duikervaring, dan bespreken we welke duik bij je past.', 'Duiken'),
  ('nl', 'snorkeling', 'Snorkelen bij het rif van Marsa Alam', 'Bekijk het rif vanaf het wateroppervlak met een duikbril en snorkel. We laten je weten waar je het water in gaat en wat je mee moet nemen.', 'Snorkelen'),
  ('nl', 'desert_safari', 'Woestijnsafari bij zonsondergang in Hurghada', 'Trek aan het eind van de middag de woestijn bij Hurghada in. Vraag ons naar de route en de vertrektijd voor de zonsondergang.', 'Woestijnsafari’s'),
  ('nl', 'beach_buggy', 'Buggyrit langs de kust bij Hurghada', 'Rijd met een buggy over de kustpaden bij Hurghada. We nemen de route en de voorwaarden om zelf te rijden met je door.', 'Buggyritten'),
  ('nl', 'transportation', 'Vervoer aan de Rode Zee', 'Geef je ophaalpunt, bestemming en reisdatum door. We kijken of je voor die rit privévervoer of een gedeelde transfer kunt boeken.', 'Transfers')
), detail(locale, activity_steps, transfer_steps, included, excluded, meeting) AS (VALUES
  ('en', ARRAY['Meet the team', 'Go over the plan together', 'Set out on the activity you agreed on', 'Return'], ARRAY['Meet your driver', 'Check the route together', 'Travel to your destination'], 'Your quote will list any guide services included.', 'Extras outside the agreed quote.', 'Once our team confirms your request, we’ll arrange the meeting point or pickup with you.'),
  ('ar', ARRAY['نتقابل مع الفريق', 'نراجع البرنامج سوا', 'نبدأ النشاط اللي اتفقنا عليه', 'نرجع بعد الرحلة'], ARRAY['تقابل السواق', 'تراجعوا الطريق سوا', 'تتحرك لوجهتك'], 'هنوضح في عرض السعر لو فيه مرشد، وإيه الخدمات المشمولة.', 'أي إضافات برّه عرض السعر اللي اتفقنا عليه.', 'بعد ما الفريق يأكد طلبك، هنتفق معاك على مكان المقابلة أو الاستلام.'),
  ('de', ARRAY['Das Team treffen', 'Den Ablauf gemeinsam besprechen', 'Mit der vereinbarten Aktivität beginnen', 'Rückkehr'], ARRAY['Den Fahrer treffen', 'Die Route absprechen', 'Zum Ziel fahren'], 'Welche Leistungen der Reiseleitung enthalten sind, steht in Ihrem Angebot.', 'Zusatzleistungen außerhalb des vereinbarten Angebots.', 'Sobald unser Team Ihre Anfrage bestätigt hat, sprechen wir den Treffpunkt oder die Abholung mit Ihnen ab.'),
  ('fr', ARRAY['Rencontre avec l’équipe', 'Présentation du programme', 'Départ pour l’activité convenue', 'Retour'], ARRAY['Rendez-vous avec le chauffeur', 'Vérification du trajet', 'Trajet jusqu’à destination'], 'Le devis précise les éventuelles prestations de guide incluses.', 'Les suppléments qui ne figurent pas dans le devis accepté.', 'Une fois votre demande confirmée par notre équipe, nous conviendrons avec vous du lieu de rendez-vous ou de prise en charge.'),
  ('pl', ARRAY['Spotkanie z zespołem', 'Wspólne omówienie planu', 'Rozpoczęcie wybranej aktywności', 'Powrót'], ARRAY['Spotkanie z kierowcą', 'Uzgodnienie trasy', 'Przejazd do miejsca docelowego'], 'W wycenie podamy, czy i jakie usługi przewodnika obejmuje cena.', 'Dodatki nieuwzględnione w zaakceptowanej wycenie.', 'Gdy nasz zespół potwierdzi Twoje zgłoszenie, ustalimy z Tobą miejsce spotkania lub odbioru.'),
  ('ru', ARRAY['Встреча с командой', 'Обсуждение плана', 'Начало выбранной программы', 'Возвращение'], ARRAY['Встреча с водителем', 'Уточнение маршрута', 'Поездка до места назначения'], 'В предложении мы укажем, входят ли в стоимость услуги гида и какие именно.', 'Дополнительные услуги, которых нет в согласованном предложении.', 'Когда наша команда подтвердит заявку, мы договоримся с вами о месте встречи или подачи машины.'),
  ('uk', ARRAY['Зустріч із командою', 'Обговорення плану', 'Початок обраної програми', 'Повернення'], ARRAY['Зустріч із водієм', 'Уточнення маршруту', 'Поїздка до місця призначення'], 'У пропозиції ми зазначимо, чи входять у вартість послуги гіда та які саме.', 'Додаткові послуги, яких немає в узгодженій пропозиції.', 'Коли наша команда підтвердить заявку, ми домовимося з вами про місце зустрічі або подачі авто.'),
  ('es', ARRAY['Encuentro con el equipo', 'Repaso del programa', 'Inicio de la actividad acordada', 'Regreso'], ARRAY['Encuentro con el conductor', 'Repaso de la ruta', 'Viaje hasta el destino'], 'El presupuesto indicará si incluye servicios de guía y cuáles son.', 'Los extras que no figuren en el presupuesto aceptado.', 'Cuando nuestro equipo confirme tu solicitud, acordaremos contigo el punto de encuentro o de recogida.'),
  ('it', ARRAY['Incontro con il team', 'Presentazione del programma', 'Inizio dell’attività concordata', 'Rientro'], ARRAY['Incontro con l’autista', 'Verifica del percorso', 'Viaggio fino a destinazione'], 'Nel preventivo indicheremo gli eventuali servizi di guida inclusi.', 'Gli extra non previsti dal preventivo concordato.', 'Una volta confermata la richiesta, concorderemo con te il punto di ritrovo o di prelievo.'),
  ('nl', ARRAY['Kennismaken met het team', 'Samen het programma doornemen', 'Beginnen aan de afgesproken activiteit', 'Terugkeer'], ARRAY['Afspreken met de chauffeur', 'Samen de route doornemen', 'Naar je bestemming rijden'], 'In je prijsopgave staat of begeleiding is inbegrepen en welke begeleiding je krijgt.', 'Extra’s die buiten de afgesproken prijsopgave vallen.', 'Zodra ons team je aanvraag bevestigt, spreken we met je af waar we elkaar ontmoeten of je ophalen.')
), options(locale, standard_title, standard_description, private_title, private_description, shared_title, shared_description) AS (VALUES
  ('en', 'Standard option', 'Ask us for the details of this option.', 'Private transfer', 'A vehicle for your party. We’ll confirm the pickup point and route with you.', 'Shared transfer', 'Share the ride with other guests. We’ll confirm the route and departure time with you.'),
  ('ar', 'الخيار الأساسي', 'اسألنا عن تفاصيل الخيار ده.', 'توصيلة خاصة', 'عربية ليك وللي معاك. هنأكد لك مكان المقابلة والطريق.', 'توصيلة مشتركة', 'هتركب مع مسافرين تانيين. هنأكد لك خط السير ومعاد التحرك.'),
  ('de', 'Standardangebot', 'Fragen Sie uns nach den Einzelheiten zu diesem Angebot.', 'Privattransfer', 'Das Fahrzeug ist für Ihre Reisegruppe reserviert. Abholort und Strecke bestätigen wir Ihnen vorab.', 'Sammeltransfer', 'Sie teilen die Fahrt mit anderen Gästen. Strecke und Abfahrtszeit bestätigen wir Ihnen vorab.'),
  ('fr', 'Formule classique', 'Demandez-nous les détails de cette formule.', 'Transfert privé', 'Un véhicule pour votre groupe. Nous vous confirmerons le lieu de prise en charge et le trajet.', 'Transfert partagé', 'Vous voyagez avec d’autres passagers. Nous vous confirmerons le trajet et l’heure de départ.'),
  ('pl', 'Opcja podstawowa', 'Zapytaj nas o szczegóły tej opcji.', 'Transfer prywatny', 'Pojazd dla Ciebie i osób, z którymi podróżujesz. Potwierdzimy miejsce odbioru i trasę.', 'Transfer wspólny', 'Jedziesz razem z innymi pasażerami. Potwierdzimy trasę i godzinę wyjazdu.'),
  ('ru', 'Основной вариант', 'Уточните у нас подробности этого варианта.', 'Индивидуальный трансфер', 'Машина только для вашей группы. Мы подтвердим место подачи и маршрут.', 'Групповой трансфер', 'Вы едете вместе с другими пассажирами. Мы подтвердим маршрут и время отправления.'),
  ('uk', 'Основний варіант', 'Запитайте нас про деталі цього варіанта.', 'Індивідуальний трансфер', 'Авто лише для вашої групи. Ми підтвердимо місце подачі та маршрут.', 'Спільний трансфер', 'Ви їдете разом з іншими пасажирами. Ми підтвердимо маршрут і час відправлення.'),
  ('es', 'Opción estándar', 'Pregúntanos por los detalles de esta opción.', 'Traslado privado', 'Un vehículo para tu grupo. Confirmaremos contigo el punto de recogida y la ruta.', 'Traslado compartido', 'Viajarás con otros pasajeros. Te confirmaremos la ruta y la hora de salida.'),
  ('it', 'Formula standard', 'Chiedici i dettagli di questa formula.', 'Trasferimento privato', 'Un veicolo per il tuo gruppo. Ti confermeremo il punto di prelievo e il percorso.', 'Trasferimento condiviso', 'Viaggerai insieme ad altri passeggeri. Ti confermeremo il percorso e l’orario di partenza.'),
  ('nl', 'Standaardoptie', 'Vraag ons naar de details van deze optie.', 'Privétransfer', 'Een voertuig voor je eigen gezelschap. We bevestigen het ophaalpunt en de route.', 'Gedeelde transfer', 'Je reist samen met andere passagiers. We bevestigen de route en de vertrektijd.')
), showcase AS (
  SELECT s.id AS service_id, c.id AS category_id, o.*
  FROM original o
  JOIN app.categories c ON c.id=md5('category:' || o.code)::uuid AND c.code=o.code AND c.active
  JOIN app.services s ON s.id=md5('service:' || o.code)::uuid AND s.category_id=c.id
  WHERE s.synthetic AND s.status='published'
    AND s.destination_id=md5('destination:' || CASE
      WHEN o.code='transportation' THEN 'port-ghalib'
      WHEN o.code IN ('desert_safari','beach_buggy') THEN 'hurghada'
      ELSE 'marsa-alam' END)::uuid
), categories_updated AS (
  UPDATE app.category_translations t SET
    label=CASE WHEN t.label=replace(initcap(s.code),'_',' ') OR (t.locale='ar' AND t.label=s.category_ar)
      THEN o.category_label ELSE t.label END,
    description=CASE WHEN t.description='Synthetic catalog category'
      OR (t.locale='ar' AND t.description='فئة من خدمات ريد سي هورايزنز') THEN o.summary ELSE t.description END
  FROM showcase s JOIN offers o ON o.code=s.code
  WHERE t.category_id=s.category_id AND t.locale=o.locale
), services_updated AS (
  UPDATE app.service_translations t SET
    title=CASE WHEN t.title=s.title_en OR (t.locale='ar' AND t.title=s.title_ar) THEN o.title ELSE t.title END,
    summary=CASE WHEN t.summary='Development preview. Details, prices and operating requirements require agency approval.'
      OR (t.locale='ar' AND t.summary='تجربة معروضة للتعريف بالخدمة. يؤكد فريق خدمة العملاء التفاصيل والسعر ومتطلبات التشغيل قبل الحجز.')
      THEN o.summary ELSE t.summary END,
    itinerary=CASE WHEN t.itinerary='["Meet the team","Activity briefing","Guided experience","Return"]'::jsonb
      OR (t.locale='ar' AND t.itinerary='["لقاء الفريق","التعريف بالنشاط","تنفيذ التجربة المتفق عليها","العودة"]'::jsonb)
      THEN to_jsonb(CASE WHEN s.code='transportation' THEN d.transfer_steps ELSE d.activity_steps END) ELSE t.itinerary END,
    inclusions=CASE WHEN t.inclusions='["Guide as described in the approved offer"]'::jsonb
      OR (t.locale='ar' AND t.inclusions='["الخدمات التي يؤكدها فريق خدمة العملاء ضمن العرض النهائي"]'::jsonb)
      THEN jsonb_build_array(d.included) ELSE t.inclusions END,
    exclusions=CASE WHEN t.exclusions='["Items outside the accepted quote"]'::jsonb
      OR (t.locale='ar' AND t.exclusions='["أي خدمات غير مذكورة في العرض النهائي"]'::jsonb)
      THEN jsonb_build_array(d.excluded) ELSE t.exclusions END,
    meeting_notes=CASE WHEN t.meeting_notes='Pickup is arranged after staff approval.'
      OR (t.locale='ar' AND t.meeting_notes='يتم تنسيق نقطة اللقاء أو الاستلام مع خدمة العملاء.')
      THEN d.meeting ELSE t.meeting_notes END
  FROM showcase s JOIN offers o ON o.code=s.code JOIN detail d ON d.locale=o.locale
  WHERE t.service_id=s.service_id AND t.locale=o.locale
), variants AS (
  SELECT v.id, s.code='transportation' AS transfer, v.variant_code='shared' AS shared
  FROM showcase s JOIN app.service_variants v ON v.service_id=s.service_id AND v.active
  WHERE (v.id=md5('variant:' || s.code)::uuid AND v.variant_code='standard')
     OR (s.code='transportation' AND v.id=md5('variant:transportation:shared')::uuid AND v.variant_code='shared')
)
UPDATE app.variant_translations t SET
  title=CASE
    WHEN v.shared AND (t.title='Shared transfer — development fixture' OR (t.locale='ar' AND t.title='انتقال مشترك')) THEN o.shared_title
    WHEN NOT v.shared AND (t.title='Standard experience' OR (t.locale='ar' AND t.title='التجربة الأساسية'))
      THEN CASE WHEN v.transfer THEN o.private_title ELSE o.standard_title END
    ELSE t.title END,
  description=CASE
    WHEN v.shared AND (t.description='Synthetic shared departure. Actual route, price and operating terms require agency approval.'
      OR (t.locale='ar' AND t.description='انتقال مشترك حسب المسار والموعد اللذين تؤكدهما خدمة العملاء.')) THEN o.shared_description
    WHEN NOT v.shared AND (t.description='Development fixture'
      OR (t.locale='ar' AND t.description='الخيار الأساسي للخدمة حسب التفاصيل التي يؤكدها فريق خدمة العملاء.'))
      THEN CASE WHEN v.transfer THEN o.private_description ELSE o.standard_description END
    ELSE t.description END
FROM variants v CROSS JOIN options o
WHERE t.variant_id=v.id AND t.locale=o.locale;

-- Luxor already has distinct copy in all ten languages.
WITH original(slug, title, description_ar) AS (VALUES
  ('marsa-alam', 'Marsa Alam', 'وجهة هادئة على البحر الأحمر للرحلات البحرية واستكشاف الشعاب.'),
  ('al-qusair', 'Al-Qusair', 'مدينة ساحلية على البحر الأحمر تجمع بين الشاطئ والطابع التاريخي.'),
  ('hurghada', 'Hurghada', 'وجهة على البحر الأحمر للرحلات البحرية والأنشطة الصحراوية.'),
  ('port-ghalib', 'Port Ghalib', 'مرسى ووجهة ساحلية بالقرب من مرسى علم.')
), places(locale, slug, title, description) AS (VALUES
  ('en', 'marsa-alam', 'Marsa Alam', 'A quiet stretch of the Red Sea coast for boat trips and reef outings.'),
  ('en', 'al-qusair', 'Al-Qusair', 'A historic coastal town with beaches on the Red Sea.'),
  ('en', 'hurghada', 'Hurghada', 'A base on the Red Sea for boat trips and excursions into the desert.'),
  ('en', 'port-ghalib', 'Port Ghalib', 'A marina on the Red Sea coast near Marsa Alam.'),
  ('ar', 'marsa-alam', 'مرسى علم', 'مكان هادي على ساحل البحر الأحمر لو نفسك تطلع رحلة بمركب أو تشوف الشعاب.'),
  ('ar', 'al-qusair', 'القصير', 'مدينة قديمة على ساحل البحر الأحمر، وليها شواطئ على طول الساحل.'),
  ('ar', 'hurghada', 'الغردقة', 'من الغردقة تقدر تطلع رحلة في البحر الأحمر أو تقضي يوم في الصحرا.'),
  ('ar', 'port-ghalib', 'بورت غالب', 'مارينا على ساحل البحر الأحمر قريبة من مرسى علم.'),
  ('de', 'marsa-alam', 'Marsa Alam', 'Ein ruhiger Küstenabschnitt am Roten Meer für Bootsfahrten und Ausflüge zu den Riffen.'),
  ('de', 'al-qusair', 'Al-Qusair', 'Eine geschichtsträchtige Küstenstadt mit Stränden am Roten Meer.'),
  ('de', 'hurghada', 'Hurghada', 'Ein Ausgangspunkt am Roten Meer für Bootsausflüge und Fahrten in die Wüste.'),
  ('de', 'port-ghalib', 'Port Ghalib', 'Ein Yachthafen an der Küste des Roten Meeres nahe Marsa Alam.'),
  ('fr', 'marsa-alam', 'Marsa Alam', 'Un coin paisible de la côte de la mer Rouge pour prendre le large ou découvrir les récifs.'),
  ('fr', 'al-qusair', 'Al-Qusair', 'Une ville côtière historique bordée de plages sur la mer Rouge.'),
  ('fr', 'hurghada', 'Hurghada', 'Un point de départ sur la mer Rouge pour les sorties en bateau et les excursions dans le désert.'),
  ('fr', 'port-ghalib', 'Port Ghalib', 'Un port de plaisance sur la côte de la mer Rouge, près de Marsa Alam.'),
  ('pl', 'marsa-alam', 'Marsa Alam', 'Spokojny odcinek wybrzeża Morza Czerwonego, skąd można wyruszyć w rejs lub na wyprawę na rafę.'),
  ('pl', 'al-qusair', 'Al-Kusajr', 'Zabytkowe nadmorskie miasto z plażami nad Morzem Czerwonym.'),
  ('pl', 'hurghada', 'Hurghada', 'Punkt wypadowy nad Morzem Czerwonym na rejsy i wycieczki na pustynię.'),
  ('pl', 'port-ghalib', 'Port Ghalib', 'Marina na wybrzeżu Morza Czerwonego, niedaleko Marsa Alam.'),
  ('ru', 'marsa-alam', 'Марса-Алам', 'Спокойный уголок на побережье Красного моря для морских прогулок и поездок к рифам.'),
  ('ru', 'al-qusair', 'Эль-Кусейр', 'Старинный прибрежный город с пляжами на Красном море.'),
  ('ru', 'hurghada', 'Хургада', 'Отсюда можно отправиться на прогулку по Красному морю или на экскурсию в пустыню.'),
  ('ru', 'port-ghalib', 'Порт-Галиб', 'Яхтенная гавань на берегу Красного моря недалеко от Марса-Алама.'),
  ('uk', 'marsa-alam', 'Марса-Алам', 'Тихе місце на узбережжі Червоного моря для морських прогулянок і поїздок до рифів.'),
  ('uk', 'al-qusair', 'Ель-Кусейр', 'Старовинне прибережне місто з пляжами на Червоному морі.'),
  ('uk', 'hurghada', 'Хургада', 'Звідси можна вирушити на прогулянку Червоним морем або на екскурсію в пустелю.'),
  ('uk', 'port-ghalib', 'Порт-Галіб', 'Яхтова гавань на березі Червоного моря неподалік від Марса-Алама.'),
  ('es', 'marsa-alam', 'Marsa Alam', 'Un rincón tranquilo de la costa del mar Rojo para salir en barco o descubrir los arrecifes.'),
  ('es', 'al-qusair', 'El Quseir', 'Una ciudad costera con historia y playas a orillas del mar Rojo.'),
  ('es', 'hurghada', 'Hurghada', 'Un punto de partida a orillas del mar Rojo para salir en barco o adentrarse en el desierto.'),
  ('es', 'port-ghalib', 'Port Ghalib', 'Un puerto deportivo en la costa del mar Rojo, cerca de Marsa Alam.'),
  ('it', 'marsa-alam', 'Marsa Alam', 'Un tranquillo tratto di costa sul Mar Rosso per gite in barca e uscite sulla barriera corallina.'),
  ('it', 'al-qusair', 'El Quseir', 'Una storica città costiera con spiagge sul Mar Rosso.'),
  ('it', 'hurghada', 'Hurghada', 'Un punto di partenza sul Mar Rosso per gite in barca ed escursioni nel deserto.'),
  ('it', 'port-ghalib', 'Port Ghalib', 'Un porto turistico sulla costa del Mar Rosso, vicino a Marsa Alam.'),
  ('nl', 'marsa-alam', 'Marsa Alam', 'Een rustige plek aan de Rode Zee voor boottochten en uitstapjes naar de riffen.'),
  ('nl', 'al-qusair', 'Al-Qusair', 'Een historische kustplaats met stranden aan de Rode Zee.'),
  ('nl', 'hurghada', 'Hurghada', 'Een uitvalsbasis aan de Rode Zee voor boottochten en uitstapjes naar de woestijn.'),
  ('nl', 'port-ghalib', 'Port Ghalib', 'Een jachthaven aan de Rode Zee, vlak bij Marsa Alam.')
)
UPDATE app.destination_translations t SET
  title=CASE WHEN t.title=o.title THEN p.title ELSE t.title END,
  description=CASE WHEN t.description='Synthetic destination content for development preview. Operator translations await approval.'
    OR (t.locale='ar' AND t.description=o.description_ar)
    THEN p.description ELSE t.description END
FROM original o JOIN places p ON p.slug=o.slug
JOIN app.destinations d ON d.id=md5('destination:' || p.slug)::uuid AND d.canonical_slug=p.slug
WHERE t.destination_id=d.id AND t.locale=p.locale;
