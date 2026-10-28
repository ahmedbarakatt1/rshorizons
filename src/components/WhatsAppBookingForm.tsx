"use client";
import {useRef,useState} from "react";
import Link from "next/link";
import {useTranslations} from "next-intl";
import type {ApartmentDetail,ServiceDetail} from "@/types/catalog";
import {teamWhatsAppNumbers,whatsappLink} from "@/modules/content/whatsapp";
import {PaymentMethods} from "./CustomerService";
import {money} from "./format";

export function WhatsAppBookingForm({locale,service,apartment}:{locale:string;service?:ServiceDetail;apartment?:ApartmentDetail}){
 const t=useTranslations(),formRef=useRef<HTMLFormElement>(null),reviewRef=useRef<HTMLDivElement>(null);
 const [draft,setDraft]=useState(""),[reviewing,setReviewing]=useState(false),[phone,setPhone]=useState<string>(teamWhatsAppNumbers[0]),[error,setError]=useState("");
 const transfer=service?.category==="transportation"||service?.category==="transfer";
 const title=service?.title??apartment?.title??"";
 const today=new Intl.DateTimeFormat("en-CA",{timeZone:"Africa/Cairo",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
 function prepare(event:React.FormEvent<HTMLFormElement>){
  event.preventDefault();setError("");
  const data=new FormData(event.currentTarget),value=(key:string)=>String(data.get(key)??"").trim();
  const checkIn=value("checkIn"),checkOut=value("checkOut");
  if(apartment&&(checkOut<=checkIn||(Date.parse(checkOut)-Date.parse(checkIn))/86400000<apartment.minNights)){setError(t("stayDatesError",{nights:apartment.minNights}));return;}
  const variant=service?.variants.find(item=>item.id===value("variant"));
  const rows=[t("bookingChatIntro"),`${t("selection")}: ${title}`,variant?`${t("details")}: ${variant.title}`:"",`${t("fullName")}: ${value("name")}`,
   apartment?`${t("checkIn")}: ${checkIn}\n${t("checkOut")}: ${checkOut}`:`${t("preferredDate")}: ${value("date")}${value("time")?` ${value("time")} (Africa/Cairo)`:""}`,
   `${t(apartment?"guests":"adults")}: ${value("guests")}`,!apartment?`${t("children")}: ${value("children")||"0"}`:"",
   value("pickup")?`${t("pickup")}: ${value("pickup")}`:"",value("dropoff")?`${t("dropoff")}: ${value("dropoff")}`:"",
   value("flight")?`${t("flight")}: ${value("flight")}`:"",value("luggage")?`${t("luggage")}: ${value("luggage")}`:"",
   ...(service?.addons.filter(addon=>data.has(`addon-${addon.variantId}`)).map(addon=>addon.title)??[]),
   `${t("paymentPreference")}: ${value("payment")==="bank"?t("bankTransfer"):value("payment")==="instapay"?"InstaPay":value("payment")==="wallet"?t("eWallet"):t("discussWithTeam")}`,
   value("notes")?`${t("message")}: ${value("notes")}`:"",t("chatConfirmRequest")];
  setDraft(rows.filter(Boolean).join("\n"));
  setReviewing(true);
  requestAnimationFrame(()=>{reviewRef.current?.focus();reviewRef.current?.scrollIntoView({behavior:"auto",block:"start"});});
 }
 return <div className="booking-columns whatsapp-booking"><div className="booking-main">
  <p className="lead">{t("bookingChatDescription")}</p>
  <div hidden={reviewing}><form ref={formRef} className="form-stack" onSubmit={prepare}>
   <h2>{title}</h2><p className="small">{t("priceConfirmedByTeam")}</p>
   {service&&service.variants.length>1&&<label>{t("details")}<select name="variant">{service.variants.map(item=><option key={item.id} value={item.id}>{item.title}</option>)}</select></label>}
   {service&&service.variants.length===1&&<input type="hidden" name="variant" value={service.variants[0].id}/>}
   <label>{t("fullName")}<input name="name" autoComplete="name" minLength={2} maxLength={120} required/></label>
   <div className="field-grid">{apartment?<><label>{t("checkIn")}<input name="checkIn" type="date" min={today} required dir="ltr"/></label><label>{t("checkOut")}<input name="checkOut" type="date" min={today} required dir="ltr"/></label></>:<><label>{t("preferredDate")}<input name="date" type="date" min={today} required dir="ltr"/></label><label>{t("preferredTime")}<input name="time" type="time" dir="ltr"/></label></>}</div>
   {apartment&&<p className="small">{t("minimumStay",{nights:apartment.minNights})}</p>}
   <div className="field-grid"><label>{apartment?t("guests"):t("adults")}<input name="guests" type="number" min="1" max={apartment?.maxGuests??30} defaultValue="1" required/></label>{!apartment&&<label>{t("children")}<input name="children" type="number" min="0" max="20" defaultValue="0" required/></label>}</div>
   {transfer&&<><label>{t("pickup")}<input name="pickup" maxLength={250} required/></label><label>{t("dropoff")}<input name="dropoff" maxLength={250} required/></label><div className="field-grid"><label>{t("flight")}<input name="flight" maxLength={20} dir="ltr"/></label><label>{t("luggage")}<input name="luggage" type="number" min="0" max="30" defaultValue="0"/></label></div></>}
   {!!service?.addons.length&&<fieldset><legend>{t("optionalExtras")}</legend>{service.addons.map(addon=><label key={addon.variantId} className="check-label"><input type="checkbox" name={`addon-${addon.variantId}`}/><span>{addon.title}</span></label>)}</fieldset>}
   <label>{t("paymentPreference")}<select name="payment"><option value="discuss">{t("discussWithTeam")}</option><option value="bank">{t("bankTransfer")}</option><option value="instapay">InstaPay</option><option value="wallet">{t("eWallet")}</option></select></label>
   <label>{t("bookingNotes")}<textarea name="notes" rows={3} maxLength={800}/></label>
   <label>{t("customerService")}<select value={phone} onChange={event=>setPhone(event.target.value)} dir="ltr">{teamWhatsAppNumbers.map(number=><option key={number} value={number}>{locale==="ar"?"واتساب":"WhatsApp"} {number}</option>)}</select></label>
   <p className="small">{t("whatsappShareNotice")} <Link href={`/${locale}/privacy`}>{t("privacy")}</Link></p>
   {error&&<p role="alert" className="form-error">{error}</p>}
   <button className="button" type="submit">{t("prepareBookingMessage")}</button>
  </form></div>
  {reviewing&&<div ref={reviewRef} tabIndex={-1} className="whatsapp-draft"><h2>{t("reviewBookingMessage")}</h2><p>{t("whatsappManual")}</p>
   <label>{t("message")}<textarea rows={12} value={draft} onChange={event=>setDraft(event.target.value)} maxLength={5000}/></label>
   {draft.trim()&&<a className="button" href={whatsappLink(phone,draft)!} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{t("continueWhatsApp")}</a>}
   <p className="small">{t("bookingNotConfirmed")}</p><button type="button" className="text-button" onClick={()=>{setReviewing(false);requestAnimationFrame(()=>formRef.current?.querySelector<HTMLInputElement>('input:not([type="hidden"])')?.focus());}}>{t("editBookingDetails")}</button>
  </div>}
 </div><aside className="booking-aside"><p>{t("from")} <bdi className="detail-price">{money(service?.fromAmountMinor??apartment?.nightlyAmountMinor??"0",service?.currency??apartment?.currency??"EGP",locale)}</bdi>{apartment?` / ${t("night")}`:""}</p><PaymentMethods/><Link className="text-link" href={`/${locale}/contact`}>{t("otherContactChannels")}</Link></aside></div>;
}
