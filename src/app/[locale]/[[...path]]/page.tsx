import Link from "next/link";
import {notFound} from "next/navigation";
import type {Metadata} from "next";
import {getTranslations,setRequestLocale} from "next-intl/server";
import {getCatalog,getService,searchServices} from "@/modules/catalog";
import {isLocale,locales} from "@/i18n/locales";
import {Catalog,Photo,Search,ServiceCard} from "@/components/Catalog";
import {Arrow} from "@/components/PublicShell";
import {BookingStatement} from "@/components/BookingStatement";
import {SeaAtlasBanner} from "@/components/SeaAtlasBanner";
import {WhatsAppBookingForm as BookingForm} from "@/components/WhatsAppBookingForm";
import {ContactChannels,PaymentMethods} from "@/components/CustomerService";
import {GuestAccess,PolicyContent,PrivateGallery,PublicGallery} from "@/components/GuestFlows";
import {Reviews} from "@/components/ReviewsPage";
import {activitySections} from "@/config/activity-sections";
import {money,tripDuration} from "@/components/format";

function detailFailure(error:unknown):never{if(typeof error==="object"&&error!==null&&"status" in error&&error.status===404)notFound();throw error;}
type Props={params:Promise<{locale:string;path?:string[]}>;searchParams:Promise<Record<string,string|string[]|undefined>>};
const privateRoots=["booking","guest-access","my-gallery","my-booking"];
export async function generateMetadata({params}:Props):Promise<Metadata> {
 const {locale,path=[]}=await params;const privatePage=privateRoots.includes(path[0]);const route=`/${locale}${path.length?`/${path.join("/")}`:""}`;const t=await getTranslations({locale});
 const key=activitySections.find(activity=>activity.slug===path[0])?.label??({experiences:"experiences",destinations:"destinations",gallery:"gallery",reviews:"reviews",about:"about",contact:"contact","payment-options":"paymentMethodsTitle",privacy:"privacy",terms:"terms","cancellation-policy":"cancellation",booking:"requestTitle","guest-access":"secureAccess","my-gallery":"privateGallery"} as Record<string,string>)[path[0]??""]??"homeTitle";
 const base=process.env.APP_BASE_URL;
 const brand=locale==="ar"?"ريد سي هورايزنز":"Red Sea Horizons";
 return {title:`${t(key)} · ${brand}`,description:t("homeIntro"),robots:{index:!privatePage&&process.env.APP_ENV==="production"&&process.env.BUSINESS_CONTENT_APPROVED==="true",follow:!privatePage&&process.env.APP_ENV==="production"&&process.env.BUSINESS_CONTENT_APPROVED==="true"},...(base&&!privatePage?{alternates:{canonical:new URL(route,base).href,languages:Object.fromEntries(locales.map(code=>[code,new URL(`/${code}${path.length?`/${path.join("/")}`:""}`,base).href]))}}:{})};
}
export default async function PublicPage({params,searchParams}:Props) {
 const {locale,path=[]}=await params;if(!isLocale(locale))notFound();setRequestLocale(locale);const t=await getTranslations();const query=await searchParams;const section=path[0]??"";const detail=path[1];const demo=process.env.DEMO_MODE==="true";
 const frame=(title:string,children:React.ReactNode,description?:string)=><main tabIndex={-1} id="main" className="page-wrap"><header className="page-heading"><h1>{title}</h1>{description&&<p>{description}</p>}</header>{children}</main>;
 if(section==="guest-access"||section==="my-booking"||section==="my-gallery"&&!detail)return frame(t("secureAccess"),<GuestAccess locale={locale}/>);
 if(section==="booking"&&detail&&detail!=="request")return frame(t("customerService"),<ContactChannels/>);
 if(section==="my-gallery"&&detail)return frame(t("privateGallery"),<PrivateGallery id={detail} locale={locale}/>);
 if(section==="contact")return frame(t("contact"),<div className="contact-layout"><ContactChannels/><PaymentMethods/></div>);
 if(section==="payment-options")return frame(t("paymentMethodsTitle"),<div className="contact-layout"><PaymentMethods/><ContactChannels/></div>);
 if(["privacy","terms","cancellation-policy"].includes(section))return frame(t(section==="cancellation-policy"?"cancellation":section),<PolicyContent slug={section} locale={locale}/>);
 if(section==="reviews")return <main tabIndex={-1} id="main" className="page-wrap reviews-page"><Reviews locale={locale}/></main>;
 if(section==="about")return frame(t("about"),<div className="about-layout"><Photo image="hero" alt={t("media_diver")} priority/><div><h2>{t("manualTitle")}</h2><p className="lead">{t("manualIntro")}</p><p>{t("noPayment")}</p><Link href={`/${locale}/contact`} className="button">{t("contact")}<Arrow/></Link></div></div>);
 if(section==="apartments" || section==="photography" || (section==="booking" && query.apartment!==undefined))notFound();
 const activity=activitySections.find(item=>item.slug===section);
 const activityLinks=<nav className="activity-links" aria-label={t("experiences")}>
  {activitySections.map(item=><Link key={item.slug} href={`/${locale}/${item.slug}`} aria-current={item.slug===section?"page":undefined}>{t(item.label)}</Link>)}
 </nav>;
 if(activity && !detail){
  const {items}=await searchServices({category:activity.category},locale);
  return frame(t(activity.label),<>{activityLinks}{items.length?<div className="catalog-grid activity-results">{items.map(item=><ServiceCard item={item} locale={locale} key={item.id}/>)}</div>:<p className="empty-state">{t("empty")}</p>}</>);
 }
 const data=await getCatalog(locale);
 if(section==="booking"&&detail==="request") {
  const serviceKey=typeof query.service==="string"?query.service:null;
  if(!serviceKey)return frame(t("requestTitle"),<><p>{t("selection")}</p><Catalog services={data.services} destinations={data.destinations} locale={locale}/></>);
  const service=await getService(serviceKey,locale).catch(detailFailure);
  return frame(t("requestTitle"),<BookingForm service={service} locale={locale}/>);
 }
 if(section==="experiences"&&detail) {
  const item=await getService(detail,locale).catch(detailFailure);
  const conditions=Object.entries(item.restrictions).map(([key,value])=>{
   if(key==="operatorApprovalRequired"&&typeof value==="boolean")
    return <p key={key}>{value?t("clearanceRequired"):`${t("clearanceLabel")}: ${t("no")}`}</p>;
   if(key==="minimumAge"&&typeof value==="number")
    return <p key={key}>{t("minimumAgeNotice",{age:value})}</p>;
   if(key==="notes"&&typeof value==="string")return <p key={key}>{value}</p>;
   const display=typeof value==="boolean"?t(value?"yes":"no"):typeof value==="string"?value:JSON.stringify(value);
   return <p key={key}><strong>{key.replaceAll("_"," ")}:</strong> {display}</p>;
  });
  return <main tabIndex={-1} id="main" className="page-wrap detail-page"><Link href={`/${locale}/experiences`} className="back-link">{t("back")} · {t("experiences")}</Link><header className="detail-heading"><div><h1>{item.title}</h1><p>{item.destination} · {tripDuration(item.durationMinutes,locale)}</p></div><p>{t("from")} <bdi className="detail-price">{money(item.fromAmountMinor,item.currency,locale)}</bdi></p></header><Photo image={item.image} alt={item.title} priority className="detail-hero"/><div className="detail-columns"><div><p className="lead">{item.summary}</p><section><h2>{t("itinerary")}</h2><ol className="itinerary">{item.itinerary.map((line,index)=><li key={index}>{line}</li>)}</ol></section><div className="split-content"><section><h2>{t("inclusions")}</h2><ul>{item.inclusions.map((line,index)=><li key={index}>{line}</li>)}</ul></section><section><h2>{t("exclusions")}</h2><ul>{item.exclusions.map((line,index)=><li key={index}>{line}</li>)}</ul></section></div><section><h2>{t("needKnow")}</h2>{conditions}<p>{item.meetingNotes}</p><Link href={`/${locale}/cancellation-policy`}>{t("cancellation")}</Link></section></div><aside className="request-panel"><h2>{t("requestExperience")}</h2><p>{t("manualIntro")}</p><div className="price-line"><span>{t("from")}</span><bdi>{money(item.fromAmountMinor,item.currency,locale)}</bdi></div><Link href={`/${locale}/booking/request?service=${encodeURIComponent(item.id)}`} className="button">{t("requestExperience")}<Arrow/></Link><p className="small">{t("noPayment")}</p><Link href={`/${locale}/payment-options`} className="text-link">{t("paymentMethodsTitle")}</Link></aside></div></main>;
 }
 const categories:Record<string,string>={safari:"desert-safari",transportation:"transportation"};
 if(section==="experiences"||section in categories)return frame(section==="experiences"?t("experiences"):section==="transportation"?t("pickup"):t("experiences"),<>{activityLinks}<Catalog services={data.services} destinations={data.destinations} locale={locale} initialGuests={Number(query.guests)||1} initialCategory={categories[section]??(typeof query.category==="string"?query.category:"")} initialDestination={typeof query.destination==="string"?query.destination:""}/></>,t("homeIntro"));
 if(section==="destinations"&&detail) {
  const destination=data.destinations.find(item=>item.slug===detail);if(!destination)notFound();
  return frame(destination.title,<><Photo image={destination.image} alt={destination.title} priority className="destination-hero"/><p className="lead">{destination.summary}</p><Catalog services={data.services} destinations={data.destinations} locale={locale} initialDestination={destination.slug}/></>);
 }
 if(section==="destinations")return frame(t("destinations"),<div className="destination-list">{data.destinations.map(item=><Link href={`/${locale}/destinations/${item.slug}`} key={item.id}><Photo image={item.image} alt={item.title}/><div><h2>{item.title}</h2><p>{item.summary}</p><span className="text-link">{t("explore")}<Arrow/></span></div></Link>)}</div>,t("homeIntro"));
 if(section==="gallery")return frame(t("previousTrips"),<><PublicGallery locale={locale} showOwnerCollection={demo||process.env.MEDIA_PUBLICATION_APPROVED==="true"}/><Link href={`/${locale}/contact`} className="button">{t("customerService")}</Link></>,t("galleryIntro"));
 if(section)notFound();
 return <main tabIndex={-1} id="main">
  <SeaAtlasBanner locale={locale}/>
  <div className="frame search-wrap"><Search locale={locale} destinations={data.destinations}/></div>
  <section className="frame section">
   <div className="section-heading"><h2>{t("experiences")}</h2><Link href={`/${locale}/experiences`} className="text-link">{t("seeAll")}<Arrow/></Link></div>
   <div className="activity-grid">{activitySections.map(activity=><Link href={`/${locale}/${activity.slug}`} key={activity.slug}>
    {activity.image==="boat-day"
      ? <div className="trip-photo-cutout trip-photo-boat"><Photo image={activity.image} alt="" sizes="(max-width:767px) 45vw, 24vw"/></div>
      : <Photo image={activity.image} alt="" sizes="(max-width:767px) 45vw, 24vw"/>}
    <div className="activity-caption"><h3>{t(activity.label)}</h3><Arrow/></div>
   </Link>)}</div>
  </section>
  <section className="destination-section section"><div className="frame">
   <div className="section-heading"><h2>{t("destinations")}</h2><Link href={`/${locale}/destinations`} className="text-link">{t("seeAll")}<Arrow/></Link></div>
   <div className="destination-index">{data.destinations.map(item=><Link href={`/${locale}/destinations/${item.slug}`} key={item.id}><h3>{item.title}</h3><p>{item.summary}</p><Arrow/></Link>)}</div>
  </div></section>
  <section className="frame section">
   <div className="section-heading"><h2>{t("previousTrips")}</h2><Link href={`/${locale}/gallery`} className="text-link">{t("gallery")}<Arrow/></Link></div>
   {demo?<div className="trip-strip">{["surface-swim","reef-pause","underwater-heart","open-water"].map(key=><Link href={`/${locale}/gallery`} key={key} aria-label={t("gallery")}><Photo image={key} alt=""/></Link>)}</div>:<Link href={`/${locale}/gallery`} className="button">{t("gallery")}</Link>}
  </section>
  <section className="manual-section frame section">
   <BookingStatement text={t("manualIntro")}/>
   <div><h2>{t("manualTitle")}</h2><p>{t("noPayment")}</p><Link href={`/${locale}/contact`} className="button">{t("contact")}<Arrow/></Link></div>
  </section>
 </main>;
}
