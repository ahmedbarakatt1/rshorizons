const subjects=["desert","buggy","apartment","luxor"] as const;
export type WebPhotoSubject=typeof subjects[number];

export function webPhoto(subject:WebPhotoSubject){
 return `/images/web/${subject}-960.webp`;
}

export function resolveWebPhoto(image:string){
 const subject=subjects.find(value=>image===webPhoto(value));
 if(!subject)return undefined;
 return {
  src:webPhoto(subject),
  srcSet:[480,960,1280].map(width=>`/images/web/${subject}-${width}.webp ${width}w`).join(", ")
 };
}
