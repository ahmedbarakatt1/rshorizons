"use client";

import {useEffect,useState} from "react";

import Link from "next/link";

import {useTranslations} from "next-intl";

import {api} from "./api";

import {money,cairoDate} from "./format";
import {OwnerGallery,TripVideo} from "./OwnerGallery";



export function GuestAccess({locale,reference=""}:{locale:string;reference?:string}) {

 const t=useTranslations();const [busy,setBusy]=useState(false);const [message,setMessage]=useState("");const [token,setToken]=useState("");

 useEffect(()=>{const url=new URL(window.location.href);const secret=url.searchParams.get("token")??new URLSearchParams(url.hash.slice(1)).get("token")??"";if(secret){setToken(secret);url.searchParams.delete("token");url.hash="";history.replaceState(null,"",url.pathname+url.search);}},[]);

 async function request(event:React.FormEvent<HTMLFormElement>) {event.preventDefault();setBusy(true);setMessage("");const form=new FormData(event.currentTarget);try{await api("/guest-access/request",{reference:form.get("reference"),contact:form.get("contact"),locale});setMessage(t("accessIntro"));}catch{setMessage(t("error"));}finally{setBusy(false);}}

 async function redeem(event:React.FormEvent<HTMLFormElement>) {event.preventDefault();setBusy(true);setMessage("");try{const result=await api<{reference?:string;redirectTo?:string;purpose?:string;galleryId?:string;invitationId?:string}>("/guest-access/redeem",{token});history.replaceState(null,"",`/${locale}/guest-access`);setToken("");window.location.assign(result.purpose==="gallery"&&result.galleryId?`/${locale}/my-gallery/${result.galleryId}`:result.purpose==="review"&&result.invitationId?`/${locale}/reviews?invitation=${result.invitationId}`:result.reference?`/${locale}/booking/${result.reference}`:`/${locale}/guest-access`);}catch{setMessage(t("error"));}finally{setBusy(false);}}

 return <div className="access-columns"><div><h2>{t("secureAccess")}</h2><p>{t("accessIntro")}</p><form className="form-stack" onSubmit={request}><label>{t("reference")}<input name="reference" defaultValue={reference} required dir="ltr" autoComplete="off"/></label><label>{t("email")} / {t("phone")}<input name="contact" required dir="ltr" autoComplete="email"/></label><button className="button" disabled={busy}>{busy?t("loading"):t("sendLink")}</button></form></div><div><h2>{t("redeem")}</h2><form className="form-stack" onSubmit={redeem}><label>{t("token")}<input name="token" type="password" value={token} onChange={event=>setToken(event.target.value)} required autoComplete="off" dir="ltr"/></label><button className="button button-secondary" disabled={busy}>{t("redeem")}</button></form></div>{message&&<p role="status" className="form-notice">{message}</p>}</div>;

}

export function ContactForm({locale}:{locale:string}) {

 const t=useTranslations();const [busy,setBusy]=useState(false);const [state,setState]=useState("");const [privacyVersion,setPrivacyVersion]=useState("");

 useEffect(()=>{api<{privacy:string}>(`/policies/current?locale=${locale}`).then(result=>setPrivacyVersion(result.privacy)).catch(()=>setState("error"));},[locale]);

 async function send(event:React.FormEvent<HTMLFormElement>) {event.preventDefault();setBusy(true);setState("");const form=event.currentTarget;const data=new FormData(form);try{await api("/contact",{name:data.get("name"),email:data.get("email"),locale,message:data.get("message"),consent:true,privacyVersion},undefined,crypto.randomUUID());setState("received");form.reset();}catch{setState("error");}finally{setBusy(false);}}

 return <form className="form-stack contact-form" onSubmit={send}><label>{t("fullName")}<input name="name" autoComplete="name" required minLength={2} maxLength={150}/></label><label>{t("email")}<input name="email" type="email" autoComplete="email" required dir="ltr"/></label><label>{t("message")}<textarea name="message" required minLength={10} maxLength={4000} rows={6}/></label><label className="check-label"><input type="checkbox" required/><span>{t("privacyConsent")} · <Link href={`/${locale}/privacy`}>{t("privacy")}</Link></span></label>{state&&<p role={state==="error"?"alert":"status"} className={state==="error"?"form-error":"form-notice"}>{t(state)}</p>}<button className="button" disabled={busy||!privacyVersion}>{busy?t("loading"):t("send")}</button></form>;

}

export type BookingDTO={id:string;reference:string;status:string;version:number;currency:string;totalAmountMinor:string;initialDueAmountMinor:string;paymentDeadline?:string;guest?:{fullName:string;email?:string;phoneE164?:string;locale:string};items:{id:string;kind:string;title:string;quantity:number;totalAmountMinor:string;fulfilmentState:string;pickup?:string}[];timeline:{type:string;at:string}[];obligations:{id:string;kind:string;amountMinor:string;currency:string;dueAt?:string;status:string}[];payments:{id:string;amountMinor:string;currency:string;status?:string;source?:string}[];pickups?:{address:string;pickupAt:string;instructions:string}[];requests:{id:string;type:string;status:string}[];revisions?:{id:string;status:string;totalAmountMinor:string;currency:string;validUntil:string;policies:Record<string,unknown>}[];galleries?:{id:string;title:string}[]};

export function BookingStatus({locale,reference}:{locale:string;reference:string}) {

 const t=useTranslations();const [booking,setBooking]=useState<BookingDTO|null>(null);const [loaded,setLoaded]=useState(false);const [busy,setBusy]=useState(false);const [message,setMessage]=useState("");const [requestType,setRequestType]=useState("change");const [methods,setMethods]=useState<string[]>([]);

 async function load(){try{const result=await api<BookingDTO>(`/bookings/${encodeURIComponent(reference)}`);setBooking(result);if(result.status==="approved_pending_payment"){const options=await api<{methods?:string[]}>(`/bookings/${encodeURIComponent(reference)}/payment-options`);setMethods(options.methods??[]);}}catch{/* Keep private failures indistinguishable from unavailable access. */}finally{setLoaded(true);}}

 useEffect(()=>{let live=true;api<BookingDTO>(`/bookings/${encodeURIComponent(reference)}`).then(result=>{if(live)setBooking(result);if(result.status==="approved_pending_payment")return api<{methods?:string[]}>(`/bookings/${encodeURIComponent(reference)}/payment-options`).then(options=>{if(live)setMethods(options.methods??[]);});}).catch(()=>{}).finally(()=>{if(live)setLoaded(true);});return()=>{live=false;};},[reference]);

 async function request(event:React.FormEvent<HTMLFormElement>){event.preventDefault();setBusy(true);setMessage("");const form=new FormData(event.currentTarget);try{await api(`/bookings/${encodeURIComponent(reference)}/${requestType==="change"?"change-requests":"cancellation-requests"}`,{reason:form.get("reason"),...(requestType==="change"?{proposedChanges:{message:form.get("reason")}}:{})},undefined,crypto.randomUUID());setMessage(t("requestSent"));await load();}catch{setMessage(t("error"));}finally{setBusy(false);}}

 async function pay(obligationId:string,method:string,billing:Record<string,FormDataEntryValue|null>){setBusy(true);setMessage("");try{const response=await api<{checkoutUrl?:string}>(`/bookings/${encodeURIComponent(reference)}/payment-attempts`,{obligationId,method,billing},undefined,crypto.randomUUID());if(response.checkoutUrl){const target=new URL(response.checkoutUrl);if(target.protocol!=="https:")throw new Error("Invalid checkout URL");window.location.assign(target.href);}else setMessage(t("requestSent"));}catch{setMessage(t("error"));}finally{setBusy(false);}}

 if(!loaded)return <p role="status">{t("loading")}</p>;

 if(!booking)return <GuestAccess locale={locale} reference={reference}/>;

 return <div className="booking-columns"><div><div className="status-heading"><span className={`status status-${booking.status}`}>{t(booking.status)}</span><bdi>{booking.reference}</bdi></div><p className="lead">{booking.status==="pending_review"?t("pendingNotice"):booking.status==="approved_pending_payment"?t("approvalNotice"):t(booking.status)}</p><h2>{t("selection")}</h2><div className="record-list">{booking.items.map(item=><article key={item.id}><div><h3>{item.title}</h3><span>{item.quantity} · {item.kind}</span>{item.pickup&&<p>{t("pickup")}: {item.pickup}</p>}</div><bdi>{money(item.totalAmountMinor,booking.currency,locale)}</bdi></article>)}</div><div className="price-line total"><strong>{t("total")}</strong><bdi>{money(booking.totalAmountMinor,booking.currency,locale)}</bdi></div>

 <h2>{t("status")}</h2><ol className="timeline">{booking.timeline.map((event,index)=><li key={index}><span>{event.type.replaceAll("_"," ")}</span><time dateTime={event.at}>{cairoDate(event.at,locale)}</time></li>)}</ol>

 {booking.obligations.length>0&&<section><h2>{t("paymentPolicy")}</h2>{booking.obligations.map(obligation=><div className="obligation" key={obligation.id}><div className="price-line"><span>{obligation.kind} · {obligation.status}</span><bdi>{money(obligation.amountMinor,obligation.currency,locale)}</bdi></div>{obligation.dueAt&&<p>{t("deadline")}: {cairoDate(obligation.dueAt,locale)}</p>}{booking.status==="approved_pending_payment"&&obligation.status!=="paid"&&methods.map(method=><form className="form-stack" key={method} onSubmit={event=>{event.preventDefault();const form=new FormData(event.currentTarget);void pay(obligation.id,method,{firstName:form.get("firstName"),lastName:form.get("lastName"),email:form.get("email"),phone:form.get("phone")});}}><h3>{t("billing")}</h3><div className="field-grid"><label>{t("firstName")}<input name="firstName" autoComplete="given-name" required/></label><label>{t("lastName")}<input name="lastName" autoComplete="family-name" required/></label><label>{t("email")}<input name="email" type="email" dir="ltr" autoComplete="email" required/></label><label>{t("phone")}<input name="phone" type="tel" dir="ltr" autoComplete="tel" pattern="[+][1-9][0-9]{6,14}" placeholder="+201234567890" required/></label></div><button className="button" disabled={busy}>{t("pay")} · {method}</button></form>)}</div>)}</section>}

 {booking.payments.length>0&&<section><h2>{t("receipt")}</h2>{booking.payments.map(payment=><div key={payment.id} className="price-line"><span>{payment.status??payment.source}</span><bdi>{money(payment.amountMinor,payment.currency,locale)}</bdi></div>)}</section>}

 {booking.galleries?.map(gallery=><Link className="button button-secondary" key={gallery.id} href={`/${locale}/my-gallery/${gallery.id}`}>{t("privateGallery")} · {gallery.title}</Link>)}

 {booking.pickups?.map((pickup,index)=><section key={index}><h2>{t("pickup")}</h2><p>{pickup.address}</p><p>{cairoDate(pickup.pickupAt,locale)}</p><p>{pickup.instructions}</p></section>)}

 {booking.revisions?.filter(revision=>revision.status==="proposed").map(revision=><form className="form-stack revision-review" key={revision.id} onSubmit={async event=>{event.preventDefault();setBusy(true);try{await api(`/bookings/${reference}/revision-acceptance`,{revisionId:revision.id,policiesAccepted:true},undefined,crypto.randomUUID());setMessage(t("requestSent"));await load();}catch{setMessage(t("error"));}finally{setBusy(false);}}}><h2>{t("change")}</h2><div className="price-line"><span>{t("total")}</span><bdi>{money(revision.totalAmountMinor,revision.currency,locale)}</bdi></div><p>{t("deadline")}: {cairoDate(revision.validUntil,locale)}</p><details><summary>{t("paymentPolicy")}</summary><dl className="revision-policies">{Object.entries(revision.policies).map(([key,value])=><div key={key}><dt>{key.replaceAll("_"," ")}</dt><dd>{typeof value==="object"?JSON.stringify(value):String(value)}</dd></div>)}</dl></details><label className="check-label"><input type="checkbox" required/><span>{t("termsConsent")} · <Link href={`/${locale}/terms`}>{t("terms")}</Link> · <Link href={`/${locale}/cancellation-policy`}>{t("cancellation")}</Link></span></label><button className="button button-secondary" disabled={busy}>{t("acceptRevision")}</button></form>)}

 </div><aside className="booking-aside"><h2>{t("manage")}</h2>{!["cancelled","rejected","expired","completed"].includes(booking.status)&&<form onSubmit={request} className="form-stack"><label>{t("details")}<select value={requestType} onChange={event=>setRequestType(event.target.value)}><option value="change">{t("change")}</option><option value="cancel">{t("cancel")}</option></select></label><label>{t("reason")}<textarea name="reason" required minLength={10} rows={5} maxLength={2000}/></label><button className="button button-secondary" disabled={busy}>{busy?t("loading"):t(requestType==="change"?"change":"cancel")}</button></form>}{message&&<p role="status">{message}</p>}{booking.requests.map(request=><p key={request.id}>{request.type} · {request.status}</p>)}<Link href={`/${locale}/contact`}>{t("contact")}</Link></aside></div>;

}

type GalleryDTO={title:string;expiresAt?:string;assets:{id:string;previewUrl?:string;title?:string;downloadAllowed?:boolean}[]};

export function PrivateGallery({locale,id}:{locale:string;id:string}) {

 const t=useTranslations();const [gallery,setGallery]=useState<GalleryDTO|null>(null);const [loaded,setLoaded]=useState(false);const [message,setMessage]=useState("");

 useEffect(()=>{api<GalleryDTO>(`/galleries/${encodeURIComponent(id)}`).then(setGallery).catch(()=>{}).finally(()=>setLoaded(true));},[id]);

 if(!loaded)return <p>{t("loading")}</p>;

 if(!gallery)return <GuestAccess locale={locale}/>;

 return <><h2>{gallery.title}</h2>{gallery.expiresAt&&<p>{cairoDate(gallery.expiresAt,locale)}</p>}<div className="gallery-grid">{gallery.assets.map(asset=><figure key={asset.id}>{asset.previewUrl&&<img src={asset.previewUrl} alt={asset.title??gallery.title} width={800} height={600} loading="lazy"/>}<figcaption>{asset.title}</figcaption>{asset.downloadAllowed&&<button className="button button-secondary" onClick={async()=>{try{const result=await api<{token:string;assets:{url:string}[]}>(`/galleries/${id}/download-grants`,{assetIds:[asset.id],derivative:"original"});const response=await fetch(result.assets[0].url,{headers:{"x-download-token":result.token},credentials:"same-origin",cache:"no-store"});if(!response.ok)throw new Error("Download unavailable");const blob=await response.blob();const local=URL.createObjectURL(blob);const link=document.createElement("a");link.href=local;link.download=`photo-${asset.id}`;link.click();setTimeout(()=>URL.revokeObjectURL(local),1000);}catch{setMessage(t("error"));}}}>{t("download")}</button>}</figure>)}</div>{message&&<p role="alert">{message}</p>}</>;

}

export function PolicyContent({slug,locale}:{slug:string;locale:string}) {

 const t=useTranslations();const [body,setBody]=useState<string|null>(null);const [loaded,setLoaded]=useState(false);

 useEffect(()=>{api<{body?:string|{type:string;text:string}[];content?:string}>(`/pages/${slug}?locale=${locale}`).then(result=>setBody(typeof result.body==="string"?result.body:Array.isArray(result.body)?result.body.map(block=>block.text).join("\n\n"):typeof result.content==="string"?result.content:null)).catch(()=>{}).finally(()=>setLoaded(true));},[slug,locale]);

 return <div className="prose">{!loaded?<p>{t("loading")}</p>:body?<div className="preserve-lines">{body}</div>:<><p className="approval-notice">{t("demo")}</p><p>{t("noPayment")}</p><p>{t("pendingNotice")}</p><Link href={`/${locale}/contact`}>{t("contact")}</Link></>}</div>;

}



export function PublicGallery({locale,demo}:{locale:string;demo:boolean}) {

 const t=useTranslations();const [galleries,setGalleries]=useState<{id:string;title:string;description?:string;assets:{id:string;url:string;width?:number;height?:number;mimeType?:string}[]}[]>([]);const [loaded,setLoaded]=useState(false);

 useEffect(()=>{api<{items:typeof galleries}>(`/galleries/public?locale=${locale}`).then(result=>setGalleries(result.items)).catch(()=>{}).finally(()=>setLoaded(true));},[locale]);

 return <>{!loaded?<p role="status">{t("loading")}</p>:galleries.length?galleries.map(gallery=><section key={gallery.id}><h2>{gallery.title}</h2><p>{gallery.description}</p><div className="editorial-gallery">{gallery.assets?.map(asset=>asset.mimeType==="video/mp4"?<TripVideo key={asset.id} src={asset.url} title={gallery.title} width={asset.width} height={asset.height}/>:<figure key={asset.id}><img className="photo" src={asset.url} width={asset.width??1200} height={asset.height??900} alt={gallery.title} loading="lazy"/></figure>)}</div></section>):demo?<OwnerGallery/>:<p className="empty-state">{t("empty")}</p>}</>;

}
