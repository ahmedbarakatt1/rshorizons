"use client";

import {useRef,useState,type FormEvent} from "react";
import Link from "next/link";
import {locales,localeNames} from "@/i18n/locales";
import {api} from "./api";
import styles from "./TripPhotoUpload.module.css";

type Subject={key:string;guestId:string;guardianId:string;evidenceRef:string;expiresAt:string};
const newSubject=():Subject=>({key:crypto.randomUUID(),guestId:"",guardianId:"",evidenceRef:"",expiresAt:""});

export function TripPhotoUpload({locale}:{locale:"ar"|"en"}){
 const t=(english:string,arabic:string)=>locale==="ar"?arabic:english;
 const [people,setPeople]=useState(""),[subjects,setSubjects]=useState<Subject[]>([]);
 const [busy,setBusy]=useState(false),[error,setError]=useState(""),[published,setPublished]=useState(false);
 const staged=useRef<{file:File;captionLocale:string;retentionDays:number;assetId:string}|null>(null);
 const sending=useRef(false);

 async function submit(event:FormEvent<HTMLFormElement>){
  event.preventDefault();
  if(sending.current)return;
  const form=event.currentTarget,fields=new FormData(form),file=form.querySelector<HTMLInputElement>('input[type="file"]')?.files?.[0];
  if(!file)return;
  setError("");setPublished(false);setBusy(true);sending.current=true;
  try{
   if(!["image/jpeg","image/png","image/webp"].includes(file.type)||file.size<1||file.size>20*1024*1024)
    throw new Error(t("Choose a JPEG, PNG or WebP photo up to 20 MiB.","اختر صورة JPEG أو PNG أو WebP بحد أقصى ٢٠ ميبيبايت."));
   const captionLocale=String(fields.get("captionLocale"));
   const retentionDays=Number(fields.get("retentionDays"));
   if(staged.current?.file!==file||staged.current.captionLocale!==captionLocale||staged.current.retentionDays!==retentionDays){
    const digest=await crypto.subtle.digest("SHA-256",await file.arrayBuffer());
    const checksumSha256=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,"0")).join("");
    const intent=await api<{assetId:string;uploadUrl:string}>("/admin/trip-photos",{locale:captionLocale,mimeType:file.type,sizeBytes:file.size,checksumSha256,retentionDays});
    const result=await fetch(intent.uploadUrl,{method:"PUT",headers:{"Content-Type":file.type},body:file,credentials:"same-origin",referrerPolicy:"no-referrer"});
    if(!result.ok)throw new Error(t("Photo upload failed. Try again.","تعذر رفع الصورة. حاول مرة أخرى."));
    staged.current={file,captionLocale,retentionDays,assetId:intent.assetId};
   }
   const roster=people==="yes"?subjects.map(subject=>({
    guestId:subject.guestId.trim(),guardianId:subject.guardianId.trim()||undefined,evidenceRef:subject.evidenceRef.trim(),
    expiresAt:subject.expiresAt?new Date(subject.expiresAt).toISOString():undefined
   })):[];
   await api(`/admin/trip-photos/${staged.current.assetId}/publish`,{
    caption:fields.get("caption"),rightsEvidenceRef:fields.get("rights"),subjectsReviewed:fields.get("reviewed")==="on",subjects:roster
   });
   staged.current=null;form.reset();setPeople("");setSubjects([]);setPublished(true);
  }catch(cause){setError(cause instanceof Error?cause.message:t("Publication failed.","تعذر النشر."));}
  finally{sending.current=false;setBusy(false);}
 }
 function changeSubject(key:string,name:keyof Omit<Subject,"key">,value:string){
  setSubjects(current=>current.map(person=>person.key===key?{...person,[name]:value}:person));
 }
 return <details className={`admin-panel trip-photo-upload ${styles.uploader}`}><summary>{t("Add a trip photo","إضافة صورة من الرحلات")}</summary>
  <form className="form-stack" onSubmit={submit}>
   <fieldset disabled={busy} className="form-stack">
    <legend>{t("Publish to the trip gallery","النشر في معرض الرحلات")}</legend>
    <label>{t("Trip photo","صورة الرحلة")}<input type="file" accept="image/jpeg,image/png,image/webp" required/></label>
    <small>{t("JPEG, PNG or WebP · up to 20 MiB","JPEG أو PNG أو WebP · حتى ٢٠ ميبيبايت")}</small>
    <label>{t("Photo caption","وصف الصورة")}<input name="caption" maxLength={180} required/></label>
    <label>{t("Caption language","لغة الوصف")}<select name="captionLocale" defaultValue={locale}>{locales.map(code=><option key={code} value={code}>{localeNames[code]}</option>)}</select></label>
    <label>{t("Private source rights reference","مرجع إثبات حقوق نشر الصورة")}<input name="rights" maxLength={500} required/></label>
    <label>{t("Retention review after (days)","مراجعة الاحتفاظ بالصورة بعد (أيام)")}<input name="retentionDays" type="number" min="1" max="3650" step="1" required/></label>
    <small>{t("Choose when this photo can be reviewed for cleanup. Published photos stay protected.","حدد موعد مراجعة هذه الصورة للتنظيف. تظل الصور المنشورة محمية.")}</small>
    <label>{t("Does the photo show identifiable people?","هل يظهر في الصورة أشخاص يمكن التعرف عليهم؟")}<select required value={people} onChange={event=>{setPeople(event.target.value);if(event.target.value==="yes"&&!subjects.length)setSubjects([newSubject()]);}}>
     <option value="">{t("Choose an answer","اختر الإجابة")}</option><option value="no">{t("No identifiable people","لا يظهر أشخاص يمكن التعرف عليهم")}</option><option value="yes">{t("Yes, record their consent","نعم، تسجيل موافقتهم")}</option>
    </select></label>
    {people==="yes"&&<><p>{t("Record each person's written permission for website marketing. Enter the consenting guardian for a minor.","سجّل الموافقة المكتوبة لكل شخص على التسويق عبر الموقع. للقاصر، أدخل بيانات ولي الأمر الذي منح الموافقة.")}</p>
     {subjects.map((person,index)=><fieldset key={person.key} className="form-stack"><legend>{t("Person","الشخص")} {index+1}</legend>
      <label>{t("Guest ID","معرّف الضيف")}<input required value={person.guestId} onChange={event=>changeSubject(person.key,"guestId",event.target.value)}/></label>
      <label>{t("Consenting guardian ID, if applicable","معرّف ولي الأمر الموافق عند الحاجة")}<input value={person.guardianId} onChange={event=>changeSubject(person.key,"guardianId",event.target.value)}/></label>
      <label>{t("Private consent reference","مرجع إثبات الموافقة")}<input required maxLength={500} value={person.evidenceRef} onChange={event=>changeSubject(person.key,"evidenceRef",event.target.value)}/></label>
      <label>{t("Consent expiry, if applicable","تاريخ انتهاء الموافقة إن وُجد")}<input type="datetime-local" value={person.expiresAt} onChange={event=>changeSubject(person.key,"expiresAt",event.target.value)}/></label>
      {subjects.length>1&&<button className="text-button" type="button" onClick={()=>setSubjects(subjects.filter(subject=>subject.key!==person.key))}>{t("Remove person","إزالة الشخص")}</button>}
     </fieldset>)}
     <button className="button button-secondary" type="button" onClick={()=>setSubjects([...subjects,newSubject()])} disabled={subjects.length>=40}>{t("Add another person","إضافة شخص آخر")}</button></>}
    <label className={styles.attestation}><input type="checkbox" name="reviewed" required/> {t("I verified the source rights and recorded everyone who needs to consent to publication.","تحققت من حقوق النشر وسجّلت كل شخص تلزم موافقته على نشر الصورة.")}</label>
    <button className="button" type="submit">{busy?t("Publishing…","جارٍ النشر…"):t("Publish trip photo","نشر صورة الرحلة")}</button>
   </fieldset>
   {error&&<p className="admin-error" role="alert">{error}</p>}
   {published&&<p role="status">{t("Photo published.","نُشرت الصورة.")} <Link href={`/${locale}/gallery`}>{t("View trip gallery","عرض معرض الرحلات")}</Link></p>}
  </form>
 </details>;
}
