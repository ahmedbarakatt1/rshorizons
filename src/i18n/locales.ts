export const locales = ["en","de","pl","fr","ru","uk","es","ar","it","nl"] as const;
export type Locale = typeof locales[number];
export function isLocale(value:string): value is Locale {return (locales as readonly string[]).includes(value);}
export function direction(locale:string) {return locale === "ar" ? "rtl" : "ltr";}
export const localeNames:Record<Locale,string> = {en:"English",de:"Deutsch",pl:"Polski",fr:"Français",ru:"Русский",uk:"Українська",es:"Español",ar:"العربية",it:"Italiano",nl:"Nederlands"};
