"use client";
import {useEffect,useState} from "react";
import {useTranslations} from "next-intl";
import {businessEmail,paymentInstructions,socialPages} from "@/config/customer-service";
import {teamWhatsAppNumbers} from "@/modules/content/whatsapp";
import {TeamWhatsAppLinks} from "./WhatsAppLinks";
import {api} from "./api";

function SocialIcon({platform}:{platform:string}){
 const common={width:20,height:20,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:1.8,strokeLinecap:"round" as const,strokeLinejoin:"round" as const,"aria-hidden":true};
 if(platform.toLowerCase()==="facebook")return <svg {...common}><path d="M14 21v-8h3l.5-3H14V8.2c0-.9.4-1.7 1.8-1.7H18V3.8c-.7-.1-1.7-.3-2.9-.3-2.8 0-4.6 1.7-4.6 4.8V10H8v3h2.5v8"/></svg>;
 if(platform.toLowerCase()==="instagram")return <svg {...common}><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.4" cy="6.6" r=".8" fill="currentColor" stroke="none"/></svg>;
 if(platform.toLowerCase()==="tiktok")return <svg {...common}><path d="M15 4v10.2a4.2 4.2 0 1 1-3-4V7h3c1.1 1.8 2.8 2.8 5 3v3c-2-.1-3.7-.8-5-2"/></svg>;
 return <svg {...common}><circle cx="12" cy="12" r="9"/><path d="M8 12h8m-4-4v8"/></svg>;
}

export function PaymentMethods(){
 const t=useTranslations(),bank=paymentInstructions;
 return <section className="payment-methods" aria-labelledby="payment-methods-heading">
  <h2 id="payment-methods-heading">{t("paymentMethodsTitle")}</h2><p>{t("paymentViaTeam")}</p>
  <dl className="payment-method-list"><div><dt>{t("bankTransfer")}</dt><dd>{bank.accountNumber||bank.iban?<>{bank.bankName&&<p>{bank.bankName}</p>}{bank.accountName&&<p>{bank.accountName}</p>}{bank.accountNumber&&<p><bdi>{bank.accountNumber}</bdi></p>}{bank.iban&&<p>IBAN: <bdi>{bank.iban}</bdi></p>}</>:t("detailsFromTeam")}</dd></div>
  <div><dt>InstaPay</dt><dd>{bank.instapay?<><bdi>{bank.instapay}</bdi><p><a className="text-link" href={bank.instapayUrl} target="_blank" rel="noopener noreferrer">{t("openInstapay")}</a></p></>:t("detailsFromTeam")}</dd></div><div><dt>{t("eWallet")}</dt><dd>{bank.walletNumber?<bdi>{bank.walletNumber}</bdi>:t("detailsFromTeam")}</dd></div></dl>
  <p className="small">{t("paymentConfirmFirst")}</p>
 </section>;
}
export function ContactChannels({compact=false}:{compact?:boolean}){
 const t=useTranslations();const [social,setSocial]=useState(socialPages);
 useEffect(()=>{let active=true;api<{items:{platform:string;url:string}[]}>("/social-links").then(result=>{if(active)setSocial([...socialPages,...result.items.filter(item=>!socialPages.some(link=>link.platform.toLowerCase()===item.platform.toLowerCase()))]);}).catch(()=>{});return()=>{active=false;};},[]);
 return <section className={compact?"contact-channels compact":"contact-channels"} aria-label={t("contact")}>
  {!compact&&<><h2>{t("customerService")}</h2><p>{t("contactDirect")}</p></>}
  <TeamWhatsAppLinks compact={compact}/>
  <div className="direct-contact-links"><a href={`mailto:${businessEmail}`}><span>{t("email")}</span><bdi>{businessEmail}</bdi></a>{teamWhatsAppNumbers.map(phone=><a href={`tel:${phone}`} key={phone}><span>{t("callUs")}</span><bdi>{phone}</bdi></a>)}</div>
  {social.some(item=>item.url.startsWith("https://"))&&<nav className="social-links" aria-label={t("socialPages")}>{social.filter(item=>item.url.startsWith("https://")).map(item=><a key={item.platform} href={item.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" aria-label={item.platform}><SocialIcon platform={item.platform}/><span>{item.platform}</span></a>)}</nav>}
 </section>;
}
