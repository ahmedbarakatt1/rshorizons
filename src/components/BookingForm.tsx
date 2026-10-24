"use client";
import {useEffect,useRef,useState} from "react";
import Link from "next/link";
import {useTranslations} from "next-intl";
import type {ApartmentDetail,ServiceDetail} from "@/types/catalog";
import {api,ApiError} from "./api";
import {money,cairoDate,cairoInstant} from "./format";

type QuoteItem={title?:string;titleSnapshot?:string;totalAmountMinor?:string;amountMinor?:string;quantity?:number;snapshot?:{nights?:{date:string;amountMinor:string}[];fees?:{kind:string;amountMinor:string;refundable?:boolean}[];cancellationPolicy?:{version:string;body:string}}};
type Quote={id:string;totalAmountMinor:string;initialDueAmountMinor:string;currency:string;validUntil:string;items:QuoteItem[];policyVersions:{terms:string;privacy:string};paymentPolicy:string};
type Receipt={reference:string;status:string;paymentRequested:false;message:string};
export function BookingForm({locale,service,apartment}:{locale:string;service?:ServiceDetail;apartment?:ApartmentDetail}) {
 const t=useTranslations(); const [quote,setQuote]=useState<Quote|null>(null);const [receipt,setReceipt]=useState<Receipt|null>(null);const [busy,setBusy]=useState(false);const [error,setError]=useState("");const [fields,setFields]=useState<Record<string,string>>({});const [adults,setAdults]=useState(1);const [children,setChildren]=useState(0);const [names,setNames]=useState<string[]>([""]);const [bookingKey,setBookingKey]=useState("");const resultRef=useRef<HTMLDivElement>(null);const selectionRef=useRef<HTMLFormElement>(null);
 const kind=apartment?"stay":service?.category==="transportation"||service?.category==="transfer"?"transfer":service?.category==="photography"?"photography":"tour";
 const [variantId,setVariantId]=useState(service?.variants[0]?.id??"");
 const [whatsappUpdates,setWhatsappUpdates]=useState(false);
 const selectedVariant=service?.variants.find(variant=>variant.id===variantId);
 const scheduled=kind==="tour"||kind==="transfer"&&["shared","departure"].includes(selectedVariant?.capacityModel??"");
 const departures=service?.departures.filter(departure=>departure.variantId===variantId)??[];
 const [packages,setPackages]=useState<{id:string;title:string;description:string;priceAmountMinor:string;currency:string}[]>([]);
 useEffect(()=>{if(service?.category==="photography"||service?.addons.length)api<{items:typeof packages}>(`/photo-packages?locale=${locale}`).then(result=>setPackages(result.items)).catch(()=>{});},[service?.category,service?.addons.length,locale]);
 const policies=apartment?.paymentPolicies??service?.paymentPolicies??[];
 const storageKey=`rsh-selection-${apartment?.id??service?.id}`;
 useEffect(()=>{try {const saved=localStorage.getItem(storageKey); if(saved&&selectionRef.current){const data=JSON.parse(saved) as Record<string,string>;for(const [name,value] of Object.entries(data)){const control=selectionRef.current.elements.namedItem(name);if(control instanceof HTMLInputElement||control instanceof HTMLSelectElement)control.value=value;}if(data.variantId&&service?.variants.some(variant=>variant.id===data.variantId))setVariantId(data.variantId);setAdults(Number(data.adults??data.guests??1));setChildren(Number(data.children??0));}}catch{/* Browser storage can be disabled; the form still works. */}},[storageKey,service?.variants]);
 function failure(cause:unknown) {setError(cause instanceof ApiError&&cause.code.includes("EXPIRED")?t("quoteExpired"):t("error"));setFields(cause instanceof ApiError?cause.fields:{});}
 async function calculate(event:React.FormEvent<HTMLFormElement>) {
  event.preventDefault();setBusy(true);setError("");setFields({});
  const form=new FormData(event.currentTarget);const number=(key:string)=>Number(form.get(key)??0);const string=(key:string)=>String(form.get(key)??"");
  const safe=Object.fromEntries([...form.entries()].filter(([key])=>["adults","children","guests","departureId","variantId","checkIn","checkOut","paymentPolicy"].includes(key)));
  try {
   localStorage.setItem(storageKey,JSON.stringify(safe));
  }catch{/* Non-sensitive recovery is optional. */}
  try {
   let item:Record<string,unknown>;
   if(kind==="stay")item={kind,apartmentId:apartment!.id,checkIn:string("checkIn"),checkOut:string("checkOut"),guests:number("guests")};
   else if(kind==="transfer"){const departure=departures.find(item=>item.id===string("departureId"));if(scheduled&&!departure)throw new Error("Select an available departure.");item={kind,variantId:string("variantId"),pickupAt:departure?.startsAt??cairoInstant(string("requestedStart")),...(departure?{departureId:departure.id}:{}),pickup:string("pickup"),dropoff:string("dropoff"),passengers:number("adults"),luggage:number("luggage"),...(string("flightNumber")?{flightNumber:string("flightNumber")}:{})};}
   else if(kind==="photography")item={kind,variantId:string("variantId"),requestedStart:cairoInstant(string("requestedStart")),participants:number("adults"),...(string("packageId")?{packageId:string("packageId")}:{})};
   else item={kind,variantId:string("variantId"),departureId:string("departureId"),adults:number("adults"),children:number("children"),...(string("pickupId")?{pickupId:string("pickupId")} : {}),addons:service?.addons.filter(addon=>form.get(`addon-${addon.variantId}`)==="on").map(addon=>({variantId:addon.variantId,quantity:1,...(string(`package-${addon.variantId}`)?{packageId:string(`package-${addon.variantId}`)}:{})}))??[]};
   const response=await api<Quote>("/quotes",{locale,paymentPolicy:string("paymentPolicy"),items:[item]},undefined,crypto.randomUUID());
   setQuote(response);setBookingKey(crypto.randomUUID());const count=kind==="stay"?number("guests"):number("adults")+(kind==="tour"?number("children"):0);setNames(Array.from({length:count},(_,i)=>names[i]??""));setTimeout(()=>resultRef.current?.focus(),0);
  }catch(cause){failure(cause);}finally{setBusy(false);}
 }
 async function submit(event:React.FormEvent<HTMLFormElement>) {
  event.preventDefault();if(!quote)return;setBusy(true);setError("");setFields({});
  const form=new FormData(event.currentTarget);
  try {
   const response=await api<Receipt>("/bookings",{quoteId:quote.id,guest:{fullName:form.get("fullName"),...(form.get("email")?{email:form.get("email")}:{}),...(form.get("phoneE164")?{phoneE164:form.get("phoneE164")}:{}),locale},participants:names.map((displayName,index)=>({displayName,ageCategory:index<adults||kind==="stay"?"adult":"child"})),consents:{termsVersion:quote.policyVersions.terms,privacyNoticeVersion:quote.policyVersions.privacy,termsAccepted:form.get("terms")==="on",whatsappBookingUpdates:form.get("whatsapp")==="on",marketing:false,publicMediaUse:false}},undefined,bookingKey);
   setReceipt(response);try{localStorage.removeItem(storageKey);}catch{/* Recovery data is optional. */}setTimeout(()=>resultRef.current?.focus(),0);
  }catch(cause){failure(cause);}finally{setBusy(false);}
 }
 if(receipt)return <div className="receipt-panel" ref={resultRef} tabIndex={-1}><span className="status status-pending_review">{t("pending_review")}</span><h2>{t("receivedRequest")}</h2><p className="lead" role="status">{t("pendingNotice")}</p><p>{t("reference")} <bdi className="reference">{receipt.reference}</bdi></p><p>{t("noPayment")}</p><Link href={`/${locale}/booking/${receipt.reference}`} className="button">{t("manage")}</Link></div>;
 return <div className="booking-columns"><div className="booking-main">
  <div className="approval-notice"><p>{t("noPayment")}</p><p>{t("manualIntro")}</p></div>
  {error&&<div className="form-error" role="alert" id="booking-errors"><p>{error}</p>{Object.keys(fields).length>0&&<ul>{Object.keys(fields).map(key=><li key={key}>{key}</li>)}</ul>}</div>}
  {!quote?<form onSubmit={calculate} ref={selectionRef} className="form-stack" aria-describedby={error?"booking-errors":undefined}>
   <h2>{t("selection")}</h2><p>{service?.title??apartment?.title}</p>
   {apartment?<div className="field-grid"><label>{t("checkIn")}<input type="date" name="checkIn" required dir="ltr"/></label><label>{t("checkOut")}<input type="date" name="checkOut" required dir="ltr"/></label><label>{t("guests")}<input name="guests" type="number" min="1" max={apartment.maxGuests} defaultValue="1" required onChange={event=>setAdults(Number(event.target.value))}/></label></div>:<>
    <label>{t("details")}<select aria-label={t("details")} name="variantId" value={variantId} onChange={event=>setVariantId(event.target.value)} required>{service?.variants.map(variant=><option key={variant.id} value={variant.id}>{variant.title}</option>)}</select></label>
    {scheduled?<label>{t("departure")}<select aria-label={t("departure")} name="departureId" key={variantId} required>{departures.map(departure=><option key={departure.id} value={departure.id}>{cairoDate(departure.startsAt,locale)} · {departure.availableSeats} {t("guests")}</option>)}</select></label>:<label>{t("start")} (Africa/Cairo)<input type="datetime-local" name="requestedStart" required dir="ltr"/></label>}
    <div className="field-grid"><label>{kind==="transfer"?t("guests"):t("adults")}<input type="number" name="adults" min="1" max="30" value={adults} onChange={event=>setAdults(Number(event.target.value))}/></label>{kind==="tour"&&<label>{t("children")}<input type="number" name="children" min="0" max="20" value={children} onChange={event=>setChildren(Number(event.target.value))}/></label>}</div>
    {kind==="transfer"&&<><label>{t("pickup")}<input name="pickup" required maxLength={400}/></label><label>{t("dropoff")}<input name="dropoff" required maxLength={400}/></label><div className="field-grid"><label>{t("flight")}<input name="flightNumber" maxLength={20} dir="ltr"/></label><label>{t("luggage")}<input name="luggage" type="number" min="0" max="30" defaultValue="0" required/></label></div></>}
    {kind==="tour"&&service?.pickupOptions.some(pickup=>pickup.variantId===variantId)&&<label>{t("pickup")}<select name="pickupId" key={`pickup-${variantId}`}><option value="">{t("meetingPoint")}</option>{service.pickupOptions.filter(pickup=>pickup.variantId===variantId).map(pickup=><option key={pickup.id} value={pickup.id}>{pickup.title} · {money(pickup.surchargeAmountMinor,pickup.currency,locale)}</option>)}</select></label>}
    {kind==="photography"&&packages.length>0&&<label>{t("photoPackage")}<select name="packageId"><option value="">{t("noPackage")}</option>{packages.map(item=><option key={item.id} value={item.id}>{item.title} · {money(item.priceAmountMinor,item.currency,locale)}</option>)}</select><span className="small">{t("packageQuoteNotice")}</span></label>}
    {kind==="tour"&&service?.addons.map(addon=><div key={addon.variantId}><label className="check-label"><input type="checkbox" name={`addon-${addon.variantId}`}/><span>{addon.title}</span></label>{packages.length>0&&<label>{t("photoPackage")} · {addon.title}<select name={`package-${addon.variantId}`}><option value="">{t("noPackage")}</option>{packages.map(item=><option key={item.id} value={item.id}>{item.title} · {money(item.priceAmountMinor,item.currency,locale)}</option>)}</select></label>}</div>)}
   </>}
   <label>{t("paymentPolicy")}<select name="paymentPolicy" required>{policies.map(policy=><option key={policy} value={policy}>{t(policy)}</option>)}</select></label>
   <button className="button" disabled={busy||policies.length===0||scheduled&&!departures.length}>{busy?t("loading"):t("calculate")}</button>
  </form>:<div ref={resultRef} tabIndex={-1}>
   <div className="quote-panel"><h2>{t("quote")}</h2>{quote.items.map((item,index)=><div className="price-line" key={index}><span>{item.title??item.titleSnapshot??service?.title??apartment?.title}</span><bdi>{money(item.totalAmountMinor??item.amountMinor??"0",quote.currency,locale)}</bdi></div>)}<div className="price-line total"><strong>{t("total")}</strong><bdi>{money(quote.totalAmountMinor,quote.currency,locale)}</bdi></div><div className="price-line"><span>{t("initialDue")}</span><bdi>{money(quote.initialDueAmountMinor,quote.currency,locale)}</bdi></div><p>{t("quoteNotice")}</p><p><time dateTime={quote.validUntil}>{cairoDate(quote.validUntil,locale)}</time> · Africa/Cairo</p><button className="text-button" type="button" onClick={()=>setQuote(null)}>{t("change")}</button></div>
   <div className="quote-breakdown">{quote.items.map((item,index)=><section key={index}>
    {!!item.snapshot?.nights?.length&&<><h3>{t("nightlyBreakdown")}</h3>{item.snapshot.nights.map(night=><div className="price-line" key={night.date}><time dateTime={night.date}>{night.date}</time><bdi>{money(night.amountMinor,quote.currency,locale)}</bdi></div>)}</>}
    {!!item.snapshot?.fees?.length&&<><h3>{t("mandatoryFees")}</h3>{item.snapshot.fees.map((fee,feeIndex)=><div className="price-line" key={feeIndex}><span>{t(({cleaning:"cleaningFee",service:"serviceFee",security_deposit:"securityDeposit",pickup:"pickupFee"} as Record<string,string>)[fee.kind]??"mandatoryFees")}{fee.refundable&&<small className="muted"> · {t("refundable")}</small>}</span><bdi>{money(fee.amountMinor,quote.currency,locale)}</bdi></div>)}</>}
    {item.snapshot?.cancellationPolicy&&<details><summary>{t("cancellation")} · {item.title}</summary><p>{item.snapshot.cancellationPolicy.body}</p><small>{item.snapshot.cancellationPolicy.version}</small></details>}
   </section>)}</div>
   <form onSubmit={submit} className="form-stack">
    <h2>{t("details")}</h2>
    <label>{t("fullName")}<input name="fullName" autoComplete="name" minLength={2} maxLength={150} required/></label>
    <label>{t("email")}<input name="email" type="email" autoComplete="email" dir="ltr" required/></label>
    <label>{t("phone")}<input name="phoneE164" type="tel" autoComplete="tel" pattern="\+[1-9][0-9]{7,14}" placeholder="+201234567890" dir="ltr" required={whatsappUpdates}/></label>
    <fieldset><legend>{t("guests")}</legend>{names.map((name,index)=><label key={index}>{t("participant")} {index+1}<input value={name} onChange={event=>setNames(current=>current.map((item,i)=>i===index?event.target.value:item))} maxLength={150} required/></label>)}</fieldset>
    <label className="check-label"><input type="checkbox" name="terms" required/><span>{t("termsConsent")} · <Link href={`/${locale}/terms`} target="_blank">{t("terms")}</Link></span></label>
    <label className="check-label"><input type="checkbox" required/><span>{t("privacyConsent")} · <Link href={`/${locale}/privacy`} target="_blank">{t("privacy")}</Link></span></label>
    <label className="check-label"><input type="checkbox" name="whatsapp" checked={whatsappUpdates} onChange={event=>setWhatsappUpdates(event.target.checked)}/><span>{t("whatsappConsent")}</span></label>
    <p className="small">{t("pendingNotice")}</p><button className="button" disabled={busy}>{busy?t("loading"):t("submit")}</button>
   </form>
  </div>}
 </div><aside className="booking-aside"><h2>{t("manualTitle")}</h2><p>{t("manualIntro")}</p><p>{t("noPayment")}</p><Link href={`/${locale}/contact`} className="text-link">{t("contact")}</Link><nav className="policy-links"><Link href={`/${locale}/terms`}>{t("terms")}</Link><Link href={`/${locale}/cancellation-policy`}>{t("cancellation")}</Link><Link href={`/${locale}/privacy`}>{t("privacy")}</Link></nav></aside></div>;
}
