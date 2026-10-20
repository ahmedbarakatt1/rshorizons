const subjects=["desert","buggy","boat","coast","apartment","transfer"] as const;
export type IllustrativeSubject=typeof subjects[number];

export function illustrativeImage(subject:IllustrativeSubject){
 return `/images/editorial/${subject}-v1-960.webp`;
}

const legacy:Record<string,IllustrativeSubject>={
 "/images/desert.svg":"desert",
 "/images/coast.svg":"coast",
 "/images/apartment.svg":"apartment"
};

export function resolveIllustrativeImage(image:string){
 const subject=(Object.hasOwn(legacy,image)?legacy[image]:undefined)??subjects.find(value=>image===illustrativeImage(value));
 if(!subject)return undefined;
 return {
  src:illustrativeImage(subject),
  srcSet:[480,960,1440].map(width=>`/images/editorial/${subject}-v1-${width}.webp ${width}w`).join(", "),
  avifSrcSet:[480,960,1440].map(width=>`/images/editorial/${subject}-v1-${width}.avif ${width}w`).join(", ")
 };
}
