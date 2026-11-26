"use client";

import {useHydrated} from "./use-hydrated";


import Link from "next/link";
import {useEffect,useRef} from "react";
import {usePathname} from "next/navigation";
import {useTranslations} from "next-intl";
import {localeNames,locales,type Locale} from "@/i18n/locales";
import {ContactChannels} from "./CustomerService";
import {activitySections} from "@/config/activity-sections";

export function Mark() {return <svg viewBox="0 0 48 48" className="brand-mark" aria-hidden="true"><path d="M3 29c7-16 18-19 26-9-13-4-12 17 14 15-18 13-36 4-32-4-4 0-6 0-8-2Z" fill="currentColor"/><path d="M7 15c11-13 31-6 31 7-6-8-16-10-31-7Z" fill="#15b1bc"/><circle cx="38" cy="12" r="5" fill="#ecc471"/></svg>;}
export function Arrow() {return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6"/></svg>;}
export function PublicShell({children,locale}:{children:React.ReactNode;locale:Locale}) {
 const t=useTranslations(); const pathname=usePathname();
 const hydrated=useHydrated();
 const menuRef=useRef<HTMLDetailsElement>(null);
 useEffect(()=>{
  const menu=menuRef.current;
  function dismissOutside(event:PointerEvent){
   if(menu?.open && event.target instanceof Node && !menu.contains(event.target))menu.open=false;
  }
  document.addEventListener("pointerdown",dismissOutside,true);
  return ()=>document.removeEventListener("pointerdown",dismissOutside,true);
 },[]);
 const brandName=locale==="ar"?"ريد سي هورايزنز":"Red Sea Horizons";
 const regionName=t("regionName");
 const links=[["experiences","experiences"],["destinations","destinations"],["gallery","gallery"],["reviews","reviews"]] as const;
 const current=(path:string)=>pathname===`/${locale}/${path}`||pathname.startsWith(`/${locale}/${path}/`)||(path==="experiences"&&activitySections.some(activity=>pathname===`/${locale}/${activity.slug}`));
 function closeMenu(restoreFocus=false){
  const menu=menuRef.current;
  if(!menu?.open)return;
  menu.open=false;
  if(restoreFocus)menu.querySelector("summary")?.focus();
 }
 return <>
  <a tabIndex={0} className="skip-link" href="#main">{t("skipContent")}</a>
  <header className="site-header">
   <Link href={`/${locale}`} className="wordmark" aria-label={brandName}><Mark/>{locale==="ar"?<span><strong>ريد سي</strong><br/>هورايزنز</span>:<span>RED SEA<br/><strong>HORIZONS</strong></span>}</Link>
   <nav className="desktop-nav" aria-label={t("menu")}>{links.map(([path,label])=><Link key={path} href={`/${locale}/${path}`} aria-current={current(path)?"page":undefined}>{t(label)}</Link>)}</nav>
   <div className="header-tools"><label className="locale-control"><span className="sr-only">{t("language")}</span><select disabled={!hydrated} aria-label={t("language")} value={locale} onChange={event=>{
    const target=event.target.value; document.cookie=`NEXT_LOCALE=${target}; path=/; max-age=31536000; SameSite=Lax`;window.location.assign(pathname.replace(/^\/[^/]+/,`/${target}`)+window.location.search);
   }}>{locales.map(code=><option key={code} value={code}>{localeNames[code]}</option>)}</select></label><Link prefetch={false} href={`/${locale}/contact`} className="manage-link" aria-current={current("contact")?"page":undefined}>{t("contact")}</Link></div>
   <details className="mobile-menu" ref={menuRef}
    onBlur={event=>{if(event.relatedTarget && !event.currentTarget.contains(event.relatedTarget))closeMenu();}}
    onKeyDown={event=>{if(event.key==="Escape"){event.preventDefault();closeMenu(true);}}}>
    <summary><span className="menu-lines" aria-hidden="true"/>{t("menu")}</summary>
    <nav aria-label={t("menu")}>{[...links,["contact","contact"]].map(([path,label])=><Link key={path} href={`/${locale}/${path}`} aria-current={current(path)?"page":undefined} onClick={()=>closeMenu()}>{t(label)}<Arrow/></Link>)}</nav>
   </details>
  </header>
  {children}
  <footer className="site-footer">
   <ContactChannels compact/>
   <div className="footer-top"><div><Mark/><p>{t("manualTitle")}</p><Link href={`/${locale}/contact`} className="text-link">{t("contact")} <Arrow/></Link></div><nav>{["experiences","destinations","gallery","reviews","about"].map(path=><Link key={path} href={`/${locale}/${path}`}>{t(path)}</Link>)}</nav><nav>{["privacy","terms","cancellation-policy","payment-options"].map((path,i)=><Link key={path} href={`/${locale}/${path}`}>{t(["privacy","terms","cancellation","paymentMethodsTitle"][i])}</Link>)}</nav></div>
   <p className="footer-name">{brandName}</p><div className="footer-bottom"><span>© {new Date().getFullYear()} {brandName}</span><span>{regionName}</span><Link href="/admin">{t("staff")}</Link></div>
  </footer>
 </>;
}
