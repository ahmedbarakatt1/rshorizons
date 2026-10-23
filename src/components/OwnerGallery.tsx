"use client";
import {useState} from "react";
import {useTranslations} from "next-intl";
import photos from "@/content/owner-photos.json";
import videos from "@/content/owner-videos.json";
import {Photo} from "./Catalog";

export function TripVideo({src,poster,title,width,height,duration}:{src:string;poster?:string;title:string;width?:number;height?:number;duration?:number}) {
 const translate=useTranslations(),t=(key:string)=>translate(`media_${key}`),[opened,setOpened]=useState(false);
 return <figure className="trip-video">
  <div className="trip-video-player">
   {opened?<video src={src} poster={poster} width={width} height={height} controls playsInline autoPlay muted preload="metadata" aria-label={title}/>:<button className="video-open" onClick={()=>setOpened(true)} aria-label={`${t("play")} — ${title}`}>
    {poster&&<img src={poster} width={width??960} height={height??540} alt="" loading="lazy"/>}<span className="video-play-label"><span aria-hidden="true">▶</span> {t("play")}</span>
   </button>}
  </div>
  <figcaption><span>{title}</span>{duration!==undefined&&<span>{Math.round(duration)}s</span>}</figcaption>
 </figure>;
}
export function OwnerGallery() {
 const translate=useTranslations(),t=(key:string)=>translate(`media_${key}`),[visible,setVisible]=useState(6);
 return <div className="owner-gallery">
  <section className="owner-video-section" aria-labelledby="trip-videos-title">
   <div className="section-heading"><div><h2 id="trip-videos-title">{t("videos")}</h2><p>{t("videoIntro")}</p></div><span>{videos.length}</span></div>
   <div className="trip-video-grid">{videos.slice(0,visible).map(video=><TripVideo key={video.key} src={`/api/v1/demo-media/${video.key}.mp4`} poster={`/api/v1/demo-media/${video.key}-poster`} title={t(video.captionKey)} width={video.width} height={video.height} duration={video.duration}/>)}</div>
   {visible<videos.length&&<button className="button button-secondary video-more" onClick={()=>setVisible(count=>Math.min(count+6,videos.length))}>{t("more")} ({visible}/{videos.length})</button>}
  </section>
  {(["trips","evenings","transport"] as const).map(group=><section className="owner-photo-section" key={group}>
   <h2>{t(group)}</h2><div className="owner-photo-gallery">{photos.filter(photo=>photo.group===group).map(photo=><figure key={photo.key}><Photo image={photo.key} alt={t(photo.captionKey)} sizes="(max-width:767px) 90vw, 30vw"/><figcaption>{t(photo.captionKey)}</figcaption></figure>)}</div>
  </section>)}
 </div>;
}
