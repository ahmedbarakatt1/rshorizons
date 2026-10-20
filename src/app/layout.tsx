import type {Metadata} from "next";
import {getLocale} from "next-intl/server";
import {connection} from "next/server";
import {direction} from "@/i18n/locales";
import "./globals.css";

export const metadata: Metadata = {
  title: "Red Sea Horizons",
  description: "Red Sea travel, diving, photography and apartment reservation requests.",
  robots: {index: process.env.APP_ENV==="production"&&process.env.BUSINESS_CONTENT_APPROVED==="true", follow: process.env.APP_ENV==="production"&&process.env.BUSINESS_CONTENT_APPROVED==="true"}
};
export default async function RootLayout({children}: {children: React.ReactNode}) {
  await connection();
  const locale = await getLocale();
  return <html data-scroll-behavior="smooth" lang={locale} dir={direction(locale)}><body>{children}</body></html>;
}
