import type {ReactNode} from "react";
import styles from "./NauticalCompass.module.css";

export function CompassActions({children}: {children: ReactNode}) {
  return (
    <div className={styles.actions}>
      {children}
      <div className={styles.scene} data-testid="nautical-compass" aria-hidden="true" dir="ltr">
        <div className={styles.instrument}>
          <div className={styles.bow}/>
          <div className={styles.crown}/>
          <div className={styles.case}/>
          <div className={styles.bezel}/>
          <div className={styles.dial} data-part="dial">
            <div className={styles.scale}/>
            <div className={styles.rose}/>
            <span className={styles.north}>N</span>
            <span className={styles.east}>E</span>
            <span className={styles.south}>S</span>
            <span className={styles.west}>W</span>
          </div>
          <div className={styles.needle} data-part="needle"/>
          <div className={styles.pivot}/>
        </div>
      </div>
    </div>
  );
}
