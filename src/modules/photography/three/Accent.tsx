"use client";
import Image from "next/image";
import {useEffect,useRef,useState} from "react";
import type {CameraIslandController} from "./island";

export function PhotographyAccent({enabled=false,alt="Concept illustration of an underwater camera",caption="Concept illustration — equipment shown is illustrative.",pauseLabel="Pause animation",resumeLabel="Resume animation"}:{enabled?:boolean;alt?:string;caption?:string;pauseLabel?:string;resumeLabel?:string}){
  const holder=useRef<HTMLDivElement>(null),controller=useRef<CameraIslandController|null>(null);
  const [loaded,setLoaded]=useState(false),[paused,setPaused]=useState(false);
  useEffect(()=>{
    if(!enabled||!holder.current)return;
    const reduced=matchMedia("(prefers-reduced-motion: reduce)");
    const connection=(navigator as Navigator&{connection?:{saveData?:boolean;effectiveType?:string}}).connection;
    if(reduced.matches||connection?.saveData||connection?.effectiveType==="2g"||window.innerWidth<768)return;
    const element=holder.current;
    let disposed=false,starting=false;
    const observer=new IntersectionObserver(async(entries)=>{
      const visible=entries[0]?.isIntersecting??false;
      if(controller.current){controller.current.visible(visible);return;}
      if(!visible||starting)return;
      starting=true;
      try{
        const {mountCameraIsland}=await import("./island");
        if(disposed)return;
        controller.current=mountCameraIsland(element,()=>setLoaded(false));
        setLoaded(true);
      }catch{setLoaded(false);}
    },{rootMargin:"80px"});
    const preferenceChange=()=>{if(reduced.matches){controller.current?.dispose();controller.current=null;setLoaded(false);}};
    reduced.addEventListener("change",preferenceChange);observer.observe(element);
    return()=>{disposed=true;observer.disconnect();reduced.removeEventListener("change",preferenceChange);controller.current?.dispose();controller.current=null;};
  },[enabled]);
  return <figure className="photography-accent" style={{margin:0}}>
    <div style={{position:"relative",aspectRatio:"3 / 2",overflow:"hidden",borderRadius:"1rem",background:"#fcf6eb"}}>
      <Image src="/illustrations/concept-camera.webp" alt={alt} width={960} height={640} sizes="(max-width: 768px) 100vw, 50vw" style={{objectFit:"contain",width:"100%",height:"100%",opacity:loaded?0:1}}/>
      <div ref={holder} aria-hidden="true" style={{position:"absolute",inset:0}}/>
    </div>
    {loaded&&<button type="button" aria-pressed={paused} onClick={()=>{controller.current?.pause(!paused);setPaused(!paused);}}>{paused?resumeLabel:pauseLabel}</button>}
    <figcaption style={{fontSize:".8rem",marginTop:".75rem"}}>{caption}</figcaption>
  </figure>;
}
export default PhotographyAccent;
