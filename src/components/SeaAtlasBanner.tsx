import Link from "next/link";
import {getTranslations} from "next-intl/server";
import {Photo} from "./Catalog";
import {Arrow} from "./PublicShell";
import styles from "./SeaAtlasBanner.module.css";

export async function SeaAtlasBanner({locale}: {locale: string}) {
  const t = await getTranslations();
  return <section className={`home-hero ${styles.banner}`} aria-labelledby="home-title">
    <div className={`frame ${styles.spread}`}>
      <div className={styles.copy}>
        <div className={styles.brand}>
          <img src="/illustrations/horizons-wave.webp" width="313" height="170" alt=""/>
          <span>{locale === "ar" ? "ريد سي هورايزنز" : "Red Sea Horizons"}</span>
        </div>
        <h1 id="home-title">{t("homeTitle")}</h1>
        <p>{t("homeIntro")}</p>
        <div className={styles.actions}>
          <Link href={`/${locale}/experiences`} className={styles.explore}>{t("explore")}<Arrow/></Link>
          <Link href={`/${locale}/gallery`} className={styles.gallery}>{t("previousTrips")}</Link>
        </div>
      </div>
      <figure className={styles.map}>
        <div className={styles.terrain}>
          <img src="/illustrations/red-sea-relief-silhouette.webp" width="1150" height="887" alt={t("redSeaRelief")} fetchPriority="high"/>
          <span className={styles.pin}><span>{t("hurghadaMapLabel")}</span></span>
        </div>
        <figcaption dir="ltr"><a href="https://registry.opendata.aws/terrain-tiles/">Mapzen · NOAA · USGS</a></figcaption>
      </figure>
      <nav className={styles.photos} aria-label={t("experiences")}>
        <Link className="hero-primary" href={`/${locale}/diving`}>
          <Photo image="hero" alt={t("media_diver")} sizes="(max-width:767px) 30vw, 15vw" priority/>
          <span>{t("catDive")}<Arrow/></span>
        </Link>
        <Link href={`/${locale}/boat-trips`}>
          <Photo image="boat-day" alt="" sizes="(max-width:767px) 30vw, 15vw"/>
          <span>{t("catBoat")}<Arrow/></span>
        </Link>
      </nav>
    </div>
  </section>;
}
