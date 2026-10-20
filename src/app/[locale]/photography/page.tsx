import Link from "next/link";
import {getTranslations,setRequestLocale} from "next-intl/server";
import {getCatalog} from "@/modules/catalog";
import {PhotographyAccent} from "@/modules/photography/three/Accent";
import {Photo,Catalog} from "@/components/Catalog";
import {Arrow} from "@/components/PublicShell";
import {locales} from "@/i18n/locales";
import type {Metadata} from "next";
export async function generateMetadata({params}:{params:Promise<{locale:string}>}):Promise<Metadata>{
 const {locale}=await params;const t=await getTranslations({locale});const base=process.env.APP_BASE_URL;
 return {title:`${t("photography")} · Red Sea Horizons`,description:t("photoIntro"),...(base?{alternates:{canonical:`${base}/${locale}/photography`,languages:Object.fromEntries(locales.map(code=>[code,`${base}/${code}/photography`]))}}:{})};
}
export default async function PhotographyPage({params}:{params:Promise<{locale:string}>}) {
 const {locale}=await params;setRequestLocale(locale);const t=await getTranslations();const data=await getCatalog(locale);const demo=process.env.DEMO_MODE==="true";
 return <>{demo&&<div className="demo-bar">{t("demo")}</div>}<main tabIndex={-1} id="main" className="page-wrap"><header className="page-heading"><h1>{t("photoTitle")}</h1><p>{t("photoIntro")}</p></header><div className="photo-feature"><Photo image={demo?"diving":"/images/coast.svg"} alt={t("photography")} priority/><div><p className="lead">{t("photoIntro")}</p><p>{t("manualIntro")}</p><Link href={`/${locale}/gallery`} className="text-link">{t("gallery")}<Arrow/></Link></div></div><Catalog services={data.services.filter(item=>item.category==="photography")} destinations={data.destinations} locale={locale}/><div className="accent-feature"><PhotographyAccent enabled={false} alt={t("photography")} caption={t("demo")}/></div><Link href={`/${locale}/guest-access`} className="button button-secondary">{t("privateGallery")}</Link></main></>;
}
