"use client";
import {useState} from "react";
import {useLocale,useTranslations} from "next-intl";
import {teamWhatsAppNumbers,whatsappLink} from "@/modules/content/whatsapp";
import {ChannelLink} from "./ChannelLink";
import panel from "./ContactPanel.module.css";
import {api} from "./api";

export function TeamWhatsAppLinks({reference,compact=false,featured=false}:{reference?:string;compact?:boolean;featured?:boolean}){
  const t=useTranslations(),locale=useLocale(),whatsappName=locale==="ar"?"واتساب":"WhatsApp";
  const draft=reference?t("whatsappBookingDraft",{reference}):t("whatsappDraft");
  return <section className={`whatsapp-contacts ${compact?"compact":""} ${featured?panel.feature:""}`} aria-label={t("whatsappTitle")}>
    {featured&&<img className={panel.reef} src="/api/v1/demo-media/reef-480" width="480" height="420" alt="" loading="lazy"/>}
    {(!compact||featured)&&<div className={featured?panel.intro:undefined}><h2>{t("whatsappTitle")}</h2>{!compact&&<p className="small">{t("whatsappManual")}</p>}</div>}
    <div className="whatsapp-contact-links">{teamWhatsAppNumbers.map(phone=>
      <ChannelLink key={phone} channel="whatsapp" href={whatsappLink(phone,draft)!} label={whatsappName} detail={phone}/>
    )}</div>
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
    {url&&<p role="status"><ChannelLink channel="whatsapp" href={url} label="Open WhatsApp draft"/></p>}
  </section>;
}
