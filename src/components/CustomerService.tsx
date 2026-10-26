"use client";
import {useEffect,useState} from "react";
import {useTranslations} from "next-intl";
import {businessEmail,paymentInstructions,socialPages} from "@/config/customer-service";
import {teamWhatsAppNumbers} from "@/modules/content/whatsapp";
import {TeamWhatsAppLinks} from "./WhatsAppLinks";
import {api} from "./api";

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
 useEffect(()=>{let active=true;api<{items:{platform:string;url:string}[]}>("/social-links").then(result=>{if(active)setSocial([...socialPages,...result.items.filter(item=>!socialPages.some(link=>link.platform===item.platform))]);}).catch(()=>{});return()=>{active=false;};},[]);
 return <section className={compact?"contact-channels compact":"contact-channels"} aria-label={t("contact")}>
  {!compact&&<><h2>{t("customerService")}</h2><p>{t("contactDirect")}</p></>}
  <TeamWhatsAppLinks compact={compact}/>
  <div className="direct-contact-links"><a href={`mailto:${businessEmail}`}><span>{t("email")}</span><bdi>{businessEmail}</bdi></a>{teamWhatsAppNumbers.map(phone=><a href={`tel:${phone}`} key={phone}><span>{t("callUs")}</span><bdi>{phone}</bdi></a>)}</div>
  {social.some(item=>item.url.startsWith("https://"))&&<nav className="social-links" aria-label={t("socialPages")}>{social.filter(item=>item.url.startsWith("https://")).map(item=><a key={item.platform} href={item.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{item.platform}</a>)}</nav>}
 </section>;
}
