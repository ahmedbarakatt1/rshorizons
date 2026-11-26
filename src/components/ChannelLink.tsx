import {ChannelIcon} from "./ChannelIcon";
import styles from "./ChannelLink.module.css";

type Props = {
  channel: string;
  href: string;
  label: string;
  detail?: string;
};

export function ChannelLink({channel, href, label, detail}: Props) {
  const external = href.startsWith("https://");
  return <a className={styles.action} data-channel={channel.toLowerCase()} href={href}
    target={external ? "_blank" : undefined} rel={external ? "noopener noreferrer" : undefined}
    referrerPolicy={external ? "no-referrer" : undefined}>
    <ChannelIcon name={channel}/>
    <span className={styles.caption}>
      <span>{label}</span>
      {detail && <bdi dir="ltr" className={styles.detail}>{detail}</bdi>}
    </span>
  </a>;
}
