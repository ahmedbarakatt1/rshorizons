"use client";
import {useTranslations} from "next-intl";
export default function ErrorPage({reset}:{reset:()=>void}){const t=useTranslations();return <main tabIndex={-1} id="main" className="page-wrap"><h1>{t("error")}</h1><button className="button" onClick={reset}>{t("retry")}</button></main>;}
