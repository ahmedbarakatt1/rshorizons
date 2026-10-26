import type {MetadataRoute} from "next";
import {locales} from "@/i18n/locales";
import {getCatalog} from "@/modules/catalog";
export default async function sitemap():Promise<MetadataRoute.Sitemap> {
 const base=process.env.APP_BASE_URL;if(!base||process.env.APP_ENV!=="production"||process.env.BUSINESS_CONTENT_APPROVED!=="true")return [];
 const paths=["","/experiences","/destinations","/apartments","/photography","/gallery","/about","/contact","/payment-options","/reviews"];
 const entries:MetadataRoute.Sitemap=paths.flatMap(path=>locales.map(locale=>({url:`${base}/${locale}${path}`,alternates:{languages:Object.fromEntries(locales.map(code=>[code,`${base}/${code}${path}`]))}})));
 const catalogs=await Promise.all(locales.map(async locale=>({locale,data:await getCatalog(locale)})));
 const groups=new Map<string,Record<string,string>>();
 for(const {locale,data} of catalogs)for(const [section,items] of [["experiences",data.services],["apartments",data.apartments],["destinations",data.destinations]] as const){
  for(const item of items){const key=`${section}:${item.id}`;const languages=groups.get(key)??{};languages[locale]=`${base}/${locale}/${section}/${item.slug}`;groups.set(key,languages);}
 }
 for(const languages of groups.values())for(const url of Object.values(languages))entries.push({url,alternates:{languages}});
 return entries;
}
