import {readFileSync,writeFileSync} from "node:fs";
const keys=["nightlyBreakdown","mandatoryFees","cleaningFee","serviceFee","securityDeposit","pickupFee","refundable","meetingPoint"];
const copy={
 en:["Nightly breakdown","Mandatory fees","Cleaning fee","Service fee","Security deposit","Pickup fee","Refundable under the stated conditions","Meet at the meeting point"],
 de:["Preis pro Nacht","Obligatorische Gebühren","Reinigungsgebühr","Servicegebühr","Kaution","Abholgebühr","Gemäß den genannten Bedingungen erstattbar","Treffen am Treffpunkt"],
 pl:["Ceny za poszczególne noce","Opłaty obowiązkowe","Opłata za sprzątanie","Opłata serwisowa","Kaucja","Opłata za odbiór","Zwrot zgodnie z podanymi warunkami","Spotkanie w miejscu zbiórki"],
 fr:["Détail par nuit","Frais obligatoires","Frais de ménage","Frais de service","Dépôt de garantie","Frais de prise en charge","Remboursable selon les conditions indiquées","Rendez-vous au point de rencontre"],
 ru:["Стоимость по ночам","Обязательные сборы","Плата за уборку","Сервисный сбор","Страховой депозит","Плата за трансфер к месту встречи","Возврат по указанным условиям","Встреча в месте сбора"],
 uk:["Вартість за кожну ніч","Обов’язкові збори","Плата за прибирання","Сервісний збір","Страховий депозит","Плата за підвезення","Повернення за вказаними умовами","Зустріч у місці збору"],
 es:["Desglose por noche","Cargos obligatorios","Cargo de limpieza","Cargo de servicio","Depósito de garantía","Cargo de recogida","Reembolsable según las condiciones indicadas","Encuentro en el punto de reunión"],
 ar:["تفاصيل السعر لكل ليلة","الرسوم الإلزامية","رسوم التنظيف","رسوم الخدمة","مبلغ التأمين","رسوم الاستلام","قابل للاسترداد وفق الشروط المذكورة","المقابلة في نقطة التجمع"],
 it:["Dettaglio per notte","Costi obbligatori","Costo di pulizia","Costo del servizio","Deposito cauzionale","Costo del prelievo","Rimborsabile secondo le condizioni indicate","Incontro al punto di ritrovo"],
 nl:["Prijs per nacht","Verplichte kosten","Schoonmaakkosten","Servicekosten","Waarborgsom","Ophaalkosten","Terugbetaalbaar volgens de vermelde voorwaarden","Afspreken bij het ontmoetingspunt"]
};
for(const [locale,values] of Object.entries(copy)){const path=`messages/${locale}.json`,data=JSON.parse(readFileSync(path,"utf8"));keys.forEach((key,index)=>data[key]=values[index]);writeFileSync(path,JSON.stringify(data,null,2)+"\n");}
