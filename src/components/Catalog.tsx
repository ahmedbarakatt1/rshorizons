"use client";
import {useState} from "react";
import Link from "next/link";
import {useTranslations} from "next-intl";
import type {ApartmentSummary,DestinationSummary,ServiceSummary} from "@/types/catalog";
import {Arrow} from "./PublicShell";
import {api} from "./api";
import {money} from "./format";
import {resolveWebPhoto} from "./catalog-imagery";
export function Photo({image,alt,priority=false,className="",sizes="(max-width:767px) 50vw, (max-width:1100px) 55vw, 40vw"}:{image:string;alt:string;priority?:boolean;className?:string;sizes?:string}) {
 const webPhoto=resolveWebPhoto(image);
 if(webPhoto)return <img className={`photo ${className}`} src={webPhoto.src} srcSet={webPhoto.srcSet} sizes={sizes} alt={alt} width="1280" height="853" loading={priority?"eager":"lazy"} fetchPriority={priority?"high":"auto"}/>;
 if(!image || image==="apartment") return <div className={`photo unavailable-photo ${className}`} role="img" aria-label={alt}><span>Port Ghalib<br/><small>Unit photography awaiting approval</small></span></div>;
 const src=image.startsWith("/")?image:`/api/v1/demo-media/${image}`;
 const responsive=src.startsWith("/api/v1/demo-media/");
 return <img className={`photo ${className}`} src={src} {...responsive?{srcSet:[480,960,1440].map(width=>`${src}-${width} ${width}w`).join(", "),sizes}:{}} alt={alt} width="1200" height="900" loading={priority?"eager":"lazy"} fetchPriority={priority?"high":"auto"}/>;
}
export function ServiceCard({item,locale}:{item:ServiceSummary;locale:string}) {
 const t=useTranslations();
 return <article className="catalog-card"><Link href={`/${locale}/experiences/${item.slug}`}><Photo image={item.image} alt={item.title}/><div className="card-meta"><span>{item.destination}</span><span>{item.durationMinutes} {t("minutes")}</span></div><h3>{item.title}</h3><p>{item.summary}</p><div className="card-bottom"><span>{t("from")} <bdi className="money">{money(item.fromAmountMinor,item.currency,locale)}</bdi></span><Arrow/></div></Link></article>;
}
export function ApartmentCard({item,locale}:{item:ApartmentSummary;locale:string}) {
 const t=useTranslations();
 return <article className="catalog-card"><Link href={`/${locale}/apartments/${item.slug}`}><Photo image={item.image} alt={item.title}/><div className="card-meta"><span>Port Ghalib</span><span>{t("guestCount",{count:item.maxGuests})}</span></div><h3>{item.title}</h3><p>{item.summary}</p><div className="card-bottom"><span><bdi className="money">{money(item.nightlyAmountMinor,item.currency,locale)}</bdi> / {t("night")}</span><Arrow/></div></Link></article>;
}
const categoryKeys:Record<string,string>={boat_tours:"catBoat",scuba_diving:"catDive",desert_safari:"catSafari",beach_buggy:"catBuggy",tours:"catTours","boat-tours":"catBoat","scuba-diving":"catDive",snorkeling:"catSnorkel","desert-safari":"catSafari","beach-buggy":"catBuggy",transportation:"catTransfer",photography:"catPhoto"};
export function Search({locale,destinations}:{locale:string;destinations:DestinationSummary[]}) {
 const t=useTranslations();
 return <form className="discovery-search" action={`/${locale}/experiences`}><label>{t("where")}<select name="destination"><option value="">{t("anyDestination")}</option>{destinations.map(item=><option value={item.slug} key={item.id}>{item.title}</option>)}</select></label><label>{t("activity")}<select name="category"><option value="">{t("allActivities")}</option>{Object.keys(categoryKeys).map(category=><option value={category} key={category}>{t(categoryKeys[category])}</option>)}</select></label><label>{t("guests")}<input name="guests" type="number" min="1" max="30" defaultValue="1"/></label><button className="button" type="submit">{t("search")}<Arrow/></button></form>;
}
export function Catalog({services,apartments,destinations,locale,initialDestination="",initialCategory="",initialGuests=1}:{services?:ServiceSummary[];apartments?:ApartmentSummary[];destinations:DestinationSummary[];locale:string;initialDestination?:string;initialCategory?:string;initialGuests?:number}) {
 const t=useTranslations();const [destination,setDestination]=useState(initialDestination);const [category,setCategory]=useState(initialCategory.replaceAll("-","_"));const [guests,setGuests]=useState(initialGuests);const [serviceResults,setServiceResults]=useState(services);const [stayResults,setStayResults]=useState(apartments);const [busy,setBusy]=useState(false);const [error,setError]=useState("");
 const result=serviceResults?.filter(item=>(!destination||item.destinationSlug===destination)&&(!category||item.category.replaceAll("_","-")===category.replaceAll("_","-")));const stays=stayResults?.filter(item=>item.maxGuests>=guests);
 return <><form className="catalog-filters" onSubmit={async event=>{event.preventDefault();setBusy(true);setError("");const form=new FormData(event.currentTarget);const params=new URLSearchParams({locale,guests:String(guests)});for(const [key,value] of form.entries())if(value)params.set(key,String(value));try{if(services){const response=await api<{items:ServiceSummary[]}>(`/services?${params}`);setServiceResults(response.items);}else{params.delete("destination");const response=await api<{items:ApartmentSummary[]}>(`/apartments?${params}`);setStayResults(response.items);}}catch{setError(t("error"));}finally{setBusy(false);}}}>
 {services&&<><label>{t("where")}<select name="destination" value={destination} onChange={event=>setDestination(event.target.value)}><option value="">{t("anyDestination")}</option>{destinations.map(item=><option key={item.id} value={item.slug}>{item.title}</option>)}</select></label><label>{t("activity")}<select name="category" value={category} onChange={event=>setCategory(event.target.value)}><option value="">{t("allActivities")}</option>{[...new Set(services.map(item=>item.category))].map(value=><option key={value} value={value}>{categoryKeys[value]?t(categoryKeys[value]):value}</option>)}</select></label><label>{t("date")}<input name="date" type="date"/></label></>}
 {apartments&&<><label>{t("checkIn")}<input name="checkIn" type="date"/></label><label>{t("checkOut")}<input name="checkOut" type="date"/></label></>}
 <label>{t("guests")}<input name="guests" type="number" min="1" max="30" value={guests} onChange={event=>setGuests(Number(event.target.value))}/></label><button className="button" disabled={busy}>{busy?t("loading"):t("checkAvailability")}</button></form>
 {error&&<p role="alert" className="form-error">{error}</p>}<div className="catalog-grid">{result?.map(item=><ServiceCard item={item} locale={locale} key={item.id}/>)}{stays?.map(item=><ApartmentCard item={item} locale={locale} key={item.id}/>)}</div>{!(result?.length||stays?.length)&&<p className="empty-state">{t("empty")}</p>}</>;
}
