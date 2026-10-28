"use client";

import {useEffect,useRef,useState} from "react";
import Link from "next/link";
import {useTranslations} from "next-intl";
import {api,ApiError} from "./api";
import {GuestAccess} from "./GuestFlows";
import type {ReviewPage} from "@/modules/reviews/types";
import "./reviews.css";

function Star({filled=true}:{filled?:boolean}){
 return <svg viewBox="0 0 24 24" width="20" height="20" fill={filled?"currentColor":"none"} stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m12 3 2.8 5.7 6.3.9-4.5 4.4 1 6.2-5.6-3-5.6 3 1-6.2L3 9.6l6.2-.9Z"/></svg>;
}

function Stars({rating,label}:{rating:number;label:string}){
 return <span className="review-stars" role="img" aria-label={label}>{[1,2,3,4,5].map(value=><Star key={value} filled={value<=Math.round(rating)}/>)}</span>;
}

export function Reviews({locale}:{locale:string}){
 const t=useTranslations();
 const [page,setPage]=useState<ReviewPage|null>(null),[rating,setRating]=useState(""),[loading,setLoading]=useState(true),[failed,setFailed]=useState(false),[reload,setReload]=useState(0),[moreBusy,setMoreBusy]=useState(false),[moreFailed,setMoreFailed]=useState(false);
 const [invitation,setInvitation]=useState(""),[accessNeeded,setAccessNeeded]=useState(false),[chosenRating,setChosenRating]=useState(0),[busy,setBusy]=useState(false),[submitted,setSubmitted]=useState(false),[formError,setFormError]=useState("");
 const requestVersion=useRef(0);
 const number=(value:number)=>new Intl.NumberFormat(locale,{maximumFractionDigits:1}).format(value);
 const date=(value:string)=>new Intl.DateTimeFormat(locale,{dateStyle:"medium",timeZone:"Africa/Cairo"}).format(new Date(value));

 useEffect(()=>{
  const url=new URL(window.location.href),fragment=new URLSearchParams(url.hash.slice(1));
  setInvitation(url.searchParams.get("invitation")??fragment.get("invitation")??"");
  setAccessNeeded(fragment.has("token")||url.searchParams.has("token"));
 },[]);

 useEffect(()=>{
  let live=true;requestVersion.current++;setLoading(true);setFailed(false);setMoreFailed(false);setMoreBusy(false);
  api<ReviewPage>(`/reviews?locale=${locale}${rating?`&rating=${rating}`:""}`).then(result=>{if(live)setPage(result);}).catch(()=>{if(live)setFailed(true);}).finally(()=>{if(live)setLoading(false);});
  return()=>{live=false;};
 },[locale,rating,reload]);

 async function more(){
  if(!page?.nextCursor||moreBusy)return;
  const version=requestVersion.current;setMoreBusy(true);setMoreFailed(false);
  try{
   const result=await api<ReviewPage>(`/reviews?locale=${locale}${rating?`&rating=${rating}`:""}&cursor=${page.nextCursor}`);
   if(version===requestVersion.current)setPage(current=>({...result,items:[...(current?.items??[]),...result.items.filter(item=>!current?.items.some(existing=>existing.id===item.id))]}));
  }catch{if(version===requestVersion.current)setMoreFailed(true);}
  finally{if(version===requestVersion.current)setMoreBusy(false);}
 }

 async function submit(event:React.FormEvent<HTMLFormElement>){
  event.preventDefault();if(busy)return;setBusy(true);setFormError("");
  const data=new FormData(event.currentTarget);
  try{
   await api("/reviews",invitation?{source:"verified",invitationId:invitation,rating:chosenRating,text:data.get("text"),locale,displayName:data.get("displayName")}:{source:"public",name:data.get("name"),rating:chosenRating,text:data.get("text"),locale,displayName:data.get("displayName"),consent:data.get("consent")==="on",website:data.get("website")},undefined,crypto.randomUUID());
   setSubmitted(true);setReload(value=>value+1);
  }catch(error){
   setFormError(error instanceof ApiError&&[401,403,404,409].includes(error.status)?"review_accessError":"review_submitError");
  }finally{setBusy(false);}
 }

 return <>
  <header className="reviews-heading"><div><h1>{t("reviews")}</h1><p>{t("review_intro")}</p></div><a href="#share-review" className="button button-secondary">{t("review_write")}</a></header>
  <div className="reviews-layout">
   <aside className="reviews-context" aria-label={t("review_summary")}>
    {page&&page.summary.total>0?<>
     <div className="review-overall"><strong>{number(page.summary.average!)}</strong><span>{t("review_outOf")}</span></div>
     <Stars rating={page.summary.average!} label={t("review_stars",{count:page.summary.average!})}/>
     <p className="reviews-total">{t("review_total",{count:page.summary.total})}</p>
     <ul className="review-distribution" aria-label={t("review_distribution")}>{[5,4,3,2,1].map(star=><li key={star} aria-label={t("review_bucket",{stars:star,count:page.summary.ratings[star]??0})}><span aria-hidden="true">{number(star)} <Star/></span><span aria-hidden="true" className="review-meter"><span style={{width:`${(page.summary.ratings[star]??0)/page.summary.total*100}%`}}/></span><span aria-hidden="true">{number(page.summary.ratings[star]??0)}</span></li>)}</ul>
    </>:<h2>{t("review_verifiedTitle")}</h2>}
    <div className="review-method"><h3>{t("review_how")}</h3><p>{t("review_verifiedIntro")}</p><p>{t("review_originals")}</p></div>
   </aside>
   <section className="reviews-feed" aria-label={t("review_published")} aria-busy={loading}>
    {(page?.summary.total??0)>0&&<div className="reviews-toolbar"><label htmlFor="review-filter">{t("review_filter")}<select id="review-filter" value={rating} onChange={event=>setRating(event.target.value)}><option value="">{t("review_allRatings")}</option>{[5,4,3,2,1].map(value=><option value={value} key={value}>{t("review_stars",{count:value})}</option>)}</select></label><span>{t("review_newest")}</span></div>}
    {loading?<p className="review-loading" role="status">{t("loading")}</p>:failed?<div className="review-state"><p role="alert">{t("review_loadError")}</p><button className="button button-secondary" onClick={()=>setReload(value=>value+1)}>{t("review_retry")}</button></div>:page&&page.summary.total===0?<div className="review-empty"><h2>{t("review_emptyTitle")}</h2><p>{t("review_emptyIntro")}</p><Link className="button" href={`/${locale}/experiences`}>{t("review_explore")}</Link></div>:page?.items.length===0?<div className="review-state"><h2>{t("review_noMatch")}</h2><p>{t("review_noMatchIntro")}</p><button className="button button-secondary" onClick={()=>setRating("")}>{t("review_allRatings")}</button></div>:<>
     <div className="reviews-entries">{page?.items.map(review=><article className="review-entry" key={review.id}><header><div><h2><bdi>{review.display_name}</bdi></h2>{review.verified&&<span className="review-verified">{t("review_verified")}</span>}</div><time dateTime={review.submitted_at}>{date(review.submitted_at)}</time></header><Stars rating={review.rating} label={t("review_stars",{count:review.rating})}/><p className="review-text" lang={review.locale} dir="auto">{review.text}</p>{review.replies.map((reply,index)=><div className="review-reply" key={`${reply.publishedAt}-${index}`}><div><strong>{t("review_reply")}</strong><time dateTime={reply.publishedAt}>{date(reply.publishedAt)}</time></div><p dir="auto">{reply.body}</p></div>)}</article>)}</div>
     <div className="reviews-pagination"><p role="status">{t("review_showing",{count:page?.items.length??0,total:page?.filteredTotal??0})}</p>{moreFailed&&<p role="alert">{t("review_loadError")}</p>}{page?.nextCursor&&<button className="button button-secondary" onClick={more} disabled={moreBusy}>{moreBusy?t("loading"):moreFailed?t("review_retry"):t("review_more")}</button>}</div>
    </>}
   </section>
  </div>
  <section className="review-share" id="share-review" aria-labelledby="review-share-title"><div><h2 id="review-share-title">{t("review_write")}</h2><p>{t("review_invitationIntro")}</p><p className="review-privacy">{t("review_privacy")}</p><Link className="text-link" href={`/${locale}/contact`}>{t("review_contact")}</Link></div><div>
   {accessNeeded?<GuestAccess locale={locale} inline/>:submitted?<div className="review-success" role="status"><h3>{t("review_thanks")}</h3><p>{t("review_submitted")}</p></div>:<form className="form-stack review-submit" onSubmit={submit}>
    {!invitation&&<label htmlFor="review-name">{t("fullName")}<input id="review-name" name="name" autoComplete="name" minLength={2} maxLength={150} required/></label>}
    <fieldset className="review-rating"><legend>{t("review_yourRating")}</legend><div>{[1,2,3,4,5].map(value=><label key={value} className={value<=chosenRating?"is-selected":""}><input type="radio" name="rating" value={value} checked={chosenRating===value} onChange={()=>setChosenRating(value)} required aria-label={t("review_stars",{count:value})}/><Star filled={value<=chosenRating}/><span aria-hidden="true">{number(value)}</span></label>)}</div></fieldset>
    <label htmlFor="review-body">{t("review_yourReview")}<textarea id="review-body" name="text" minLength={10} maxLength={4000} required rows={6} aria-describedby="review-immutable"/></label>
    <label htmlFor="review-display-name">{t("review_displayName")}<select id="review-display-name" name="displayName" defaultValue={invitation?"initials":"first_name"}><option value="initials">{t("review_initials")}</option><option value="first_name">{t("review_firstName")}</option><option value="anonymous">{t("review_anonymous")}</option></select></label>
    {!invitation&&<><label className="check-label"><input name="consent" type="checkbox" required/><span>{t("privacyConsent")} · <Link href={`/${locale}/privacy`}>{t("privacy")}</Link></span></label><label className="review-honeypot" aria-hidden="true">Website<input name="website" tabIndex={-1} autoComplete="off"/></label></>}
    <p id="review-immutable" className="review-form-help">{t("review_immutable")}</p>
    {formError&&<p role="alert" className="form-error">{t(formError)}</p>}
    <button className="button" disabled={busy}>{busy?t("loading"):t("review_submit")}</button>
   </form>}
  </div></section>
 </>;
}
