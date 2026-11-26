"use client";
import {useEffect,useState} from "react";
import {useLocale,useTranslations} from "next-intl";
import {businessEmail,paymentInstructions,socialPages} from "@/config/customer-service";
import {teamWhatsAppNumbers} from "@/modules/content/whatsapp";
import {TeamWhatsAppLinks} from "./WhatsAppLinks";
import {ChannelIcon} from "./ChannelIcon";
import {ChannelLink} from "./ChannelLink";
import panel from "./ContactPanel.module.css";
import {api} from "./api";

export function PaymentMethods(){
 const t=useTranslations(),bank=paymentInstructions;
 return <section className={`payment-methods ${panel.payment}`} aria-labelledby="payment-methods-heading">
  <h2 id="payment-methods-heading">{t("paymentMethodsTitle")}</h2><p>{t("paymentViaTeam")}</p>
  <dl className="payment-method-list"><div><dt><ChannelIcon name="bank"/>{t("bankTransfer")}</dt><dd>{bank.accountNumber||bank.iban?<>{bank.bankName&&<p>{bank.bankName}</p>}{bank.accountName&&<p>{bank.accountName}</p>}{bank.accountNumber&&<p><bdi>{bank.accountNumber}</bdi></p>}{bank.iban&&<p>IBAN: <bdi>{bank.iban}</bdi></p>}</>:t("detailsFromTeam")}</dd></div>
  <div><dt><ChannelIcon name="instapay"/>InstaPay</dt><dd>{bank.instapay?<><bdi>{bank.instapay}</bdi><p><ChannelLink channel="instapay" href={bank.instapayUrl} label={t("openInstapay")}/></p></>:t("detailsFromTeam")}</dd></div><div><dt><ChannelIcon name="wallet"/>{t("eWallet")}</dt><dd>{bank.walletNumber?<bdi>{bank.walletNumber}</bdi>:t("detailsFromTeam")}</dd></div></dl>
  <p className="small">{t("paymentConfirmFirst")}</p>
 </section>;
}
export function ContactChannels({compact=false, introduction=true}:{compact?:boolean;introduction?:boolean}){
 const t=useTranslations(),locale=useLocale();const [social,setSocial]=useState(socialPages);
 const socialName=(platform:string)=>locale==="ar"?({facebook:"فيسبوك",instagram:"إنستغرام",tiktok:"تيك توك"}[platform.toLowerCase()]??platform):platform;
 useEffect(()=>{let active=true;api<{items:{platform:string;url:string}[]}>("/social-links").then(result=>{if(active)setSocial([...socialPages,...result.items.filter(item=>!socialPages.some(link=>link.platform.toLowerCase()===item.platform.toLowerCase()))]);}).catch(()=>{});return()=>{active=false;};},[]);
 return <section className={`contact-channels ${compact?`compact ${panel.footer}`:""} ${panel.channels}`} aria-label={t("contact")}>
  {!compact&&introduction&&<><h2>{t("customerService")}</h2><p>{t("contactDirect")}</p></>}
  <TeamWhatsAppLinks compact={compact} featured/>
  <div className={panel.directory}>
  <div className="direct-contact-links">
    <ChannelLink channel="email" href={`mailto:${businessEmail}`} label={t("email")} detail={businessEmail}/>
    {teamWhatsAppNumbers.map(phone=><ChannelLink key={phone} channel="phone" href={`tel:${phone}`} label={t("callUs")} detail={phone}/>)}
  </div>
  {social.some(item=>item.url.startsWith("https://"))&&<nav className="social-links" aria-label={t("socialPages")}>
    {social.filter(item=>item.url.startsWith("https://")).map(item=><ChannelLink key={item.platform} channel={item.platform} href={item.url} label={socialName(item.platform)}/>)}
  </nav>}
  </div>
 </section>;
}
