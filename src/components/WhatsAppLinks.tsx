"use client";
import {useState} from "react";
import {useLocale,useTranslations} from "next-intl";
import {teamWhatsAppNumbers,whatsappLink} from "@/modules/content/whatsapp";
import {api} from "./api";

export function TeamWhatsAppLinks({reference,compact=false}:{reference?:string;compact?:boolean}){
  const t=useTranslations(),locale=useLocale(),whatsappName=locale==="ar"?"واتساب":"WhatsApp";
  const draft=reference?t("whatsappBookingDraft",{reference}):t("whatsappDraft");
  return <section className={compact?"whatsapp-contacts compact":"whatsapp-contacts"} aria-label={t("whatsappTitle")}>
    {!compact&&<><h2>{t("whatsappTitle")}</h2><p className="small">{t("whatsappManual")}</p></>}
    <div className="whatsapp-contact-links">{teamWhatsAppNumbers.map(phone=><a key={phone} href={whatsappLink(phone,draft)!} className={compact?"text-link":"button button-secondary"} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{whatsappName} <bdi>{phone}</bdi></a>)}</div>
  </section>;
}

export function GuestWhatsAppLink({bookingId}:{bookingId:string}){
  const [url,setUrl]=useState<string|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(false);
  async function prepare(){
    setBusy(true);setError("");setUrl(null);
    try{const result=await api<{url:string}>(`/admin/bookings/${bookingId}/whatsapp-link`);setUrl(result.url);}
    catch{setError("A valid guest phone number and current WhatsApp consent are required. Refresh the reservation to check access.");}
    finally{setBusy(false);}
  }
  return <section className="whatsapp-contacts"><h2>WhatsApp guest</h2><p>Prepare a draft for the saved guest number. Review it and press Send in WhatsApp. Opening a chat does not record delivery or approve the reservation.</p>
    <button type="button" className="button button-secondary" onClick={prepare} disabled={busy}>{busy?"Preparing…":"Prepare WhatsApp message"}</button>
    {error&&<p role="alert" className="admin-error">{error}</p>}
    {url&&<p role="status"><a className="text-link" href={url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Open WhatsApp draft</a></p>}
  </section>;
}
