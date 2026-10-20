import {NextIntlClientProvider} from "next-intl";
import {getMessages,setRequestLocale} from "next-intl/server";
import {notFound} from "next/navigation";
import {isLocale} from "@/i18n/locales";
import {PublicShell} from "@/components/PublicShell";

export default async function LocaleLayout({children,params}:{children:React.ReactNode;params:Promise<{locale:string}>}) {
 const {locale}=await params;
 if(!isLocale(locale)) notFound();
 setRequestLocale(locale);
 const messages=await getMessages();
 return <NextIntlClientProvider locale={locale} messages={messages}><PublicShell locale={locale}>{children}</PublicShell></NextIntlClientProvider>;
}
