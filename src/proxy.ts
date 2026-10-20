import createMiddleware from "next-intl/middleware";
import {NextRequest,NextResponse} from "next/server";
import {locales} from "./i18n/locales";

const localeMiddleware=createMiddleware({locales,defaultLocale:"en",localePrefix:"always",localeDetection:true});
export default function proxy(request:NextRequest) {
  const nonce=Buffer.from(crypto.randomUUID()).toString("base64");
  const policy=`default-src 'self'; script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${process.env.NODE_ENV==="development"?" 'unsafe-eval'":""}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self'; connect-src 'self' https://*.supabase.co; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'`;
  const headers=new Headers(request.headers);headers.set("x-nonce",nonce);headers.set("Content-Security-Policy",policy);
  const secured=new NextRequest(request,{headers});
  const response=request.nextUrl.pathname.startsWith("/admin")?NextResponse.next({request:{headers}}):localeMiddleware(secured);
  response.headers.set("Content-Security-Policy",policy);
  if(/\/(admin|booking|guest-access|my-booking|my-gallery)(\/|$)/.test(request.nextUrl.pathname)) {
    response.headers.set("Cache-Control","private, no-store");
    response.headers.set("Referrer-Policy","no-referrer");
    response.headers.set("X-Robots-Tag","noindex, nofollow");
  }
  return response;
}
export const config={matcher:["/((?!api|_next|_vercel|.*\\..*).*)"]};
