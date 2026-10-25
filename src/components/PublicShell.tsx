"use client";
import {useEffect,useState} from "react";
import {api} from "./api";
import Link from "next/link";
import {usePathname} from "next/navigation";
import {useTranslations} from "next-intl";
import {localeNames,locales,type Locale} from "@/i18n/locales";
import {TeamWhatsAppLinks} from "./WhatsAppLinks";

export function Mark() {return <svg viewBox="0 0 48 48" className="brand-mark" aria-hidden="true"><path d="M3 29c7-16 18-19 26-9-13-4-12 17 14 15-18 13-36 4-32-4-4 0-6 0-8-2Z" fill="currentColor"/><path d="M7 15c11-13 31-6 31 7-6-8-16-10-31-7Z" fill="#15b1bc"/><circle cx="38" cy="12" r="5" fill="#ecc471"/></svg>;}
export function Arrow() {return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6"/></svg>;}
export function PublicShell({children,locale}:{children:React.ReactNode;locale:Locale}) {
 const t=useTranslations(); const pathname=usePathname();const [social,setSocial]=useState<{platform:string;url:string}[]>([]);
 useEffect(()=>{api<{items:typeof social}>("/social-links").then(result=>setSocial(result.items)).catch(()=>{});},[]);
 const links=[["experiences","experiences"],["destinations","destinations"],["apartments","apartments"],["photography","photography"],["reviews","reviews"]] as const;
 return <>
  <a tabIndex={0} className="skip-link" href="#main">{t("skipContent")}</a>
  <header className="site-header">
   <Link href={`/${locale}`} className="wordmark" aria-label="Red Sea Horizons"><Mark/><span>RED SEA<br/><strong>HORIZONS</strong></span></Link>
   <nav className="desktop-nav" aria-label={t("menu")}>{links.map(([path,label])=><Link key={path} href={`/${locale}/${path}`} aria-current={pathname.startsWith(`/${locale}/${path}`)?"page":undefined}>{t(label)}</Link>)}</nav>
   <div className="header-tools"><label className="locale-control"><span className="sr-only">{t("language")}</span><select aria-label={t("language")} value={locale} onChange={event=>{
    const target=event.target.value; document.cookie=`NEXT_LOCALE=${target}; path=/; max-age=31536000; SameSite=Lax`;window.location.assign(pathname.replace(/^\/[^/]+/,`/${target}`)+window.location.search);
   }}>{locales.map(code=><option key={code} value={code}>{localeNames[code]}</option>)}</select></label><Link prefetch={false} href={`/${locale}/guest-access`} className="manage-link">{t("manage")}</Link></div>
   <details className="mobile-menu"><summary>{t("menu")}</summary><nav>{links.map(([path,label])=><Link key={path} href={`/${locale}/${path}`}>{t(label)}</Link>)}<Link prefetch={false} href={`/${locale}/guest-access`}>{t("manage")}</Link><Link href={`/${locale}/contact`}>{t("contact")}</Link></nav></details>
  </header>
  {children}
  <footer className="site-footer">
   <TeamWhatsAppLinks compact/>
   <div className="footer-top"><div><Mark/><p>{t("manualTitle")}</p><Link href={`/${locale}/contact`} className="text-link">{t("contact")} <Arrow/></Link></div><nav>{["experiences","destinations","apartments","gallery","reviews","about"].map(path=><Link key={path} href={`/${locale}/${path}`}>{t(path)}</Link>)}</nav><nav>{["privacy","terms","cancellation-policy","guest-access"].map((path,i)=><Link key={path} href={`/${locale}/${path}`}>{t(["privacy","terms","cancellation","manage"][i])}</Link>)}</nav></div>
   {social.length>0&&<nav className="social-links" aria-label={t("contact")}>{social.filter(link=>link.url.startsWith("https://")).map(link=><a key={link.platform} href={link.url} target="_blank" rel="noopener noreferrer">{link.platform}</a>)}</nav>}<p className="footer-name">Red Sea Horizons</p><div className="footer-bottom"><span>© {new Date().getFullYear()} Red Sea Horizons</span><span>Egypt · Red Sea</span><Link href="/admin">{t("staff")}</Link></div>
  </footer>
 </>;
}
