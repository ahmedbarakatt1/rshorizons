import Link from "next/link";
import {getLocale,getTranslations} from "next-intl/server";

export default async function NotFound() {
  const locale=await getLocale();
  const t=await getTranslations();
  return <main className="page-wrap" id="main" tabIndex={-1}>
    <header className="page-heading"><h1>404</h1><p>{t("pageMissing")}</p></header>
    <Link className="button" href={`/${locale}/experiences`}>{t("review_explore")}</Link>
  </main>;
}
