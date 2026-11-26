import type {ReactNode} from "react";
import styles from "./ChannelIcon.module.css";

const symbols: Record<string, ReactNode> = {
  instapay: <><path d="M3 8h15l-4-4m7 12H6l4 4"/></>,
  globe: <><circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/></>,
  email: <><rect x="2.5" y="4.5" width="19" height="15" rx="2.5"/><path d="m4 6 8 6 8-6"/></>,
  phone: <path d="m8.7 3.8 1.4 3.5c.2.5 0 1-.4 1.4L8 10.1a13.6 13.6 0 0 0 5.9 5.9l1.4-1.7c.4-.4.9-.6 1.4-.4l3.5 1.4c.6.3.9.9.8 1.5l-.4 2.5c-.1.9-.9 1.6-1.8 1.6C10.1 20.9 3.1 13.9 3.1 5.2c0-.9.7-1.7 1.6-1.8L7.2 3c.6-.1 1.2.2 1.5.8Z"/>,
  whatsapp: <><path d="M21 11.7a9 9 0 0 1-13.4 7.9L3 21l1.4-4.5A9 9 0 1 1 21 11.7Z"/><path fill="currentColor" stroke="none" d="M8.2 6.9c.3-.2.9-.2 1.1.3l1 2.2c.1.3-.1.5-.7 1.2-.2.2-.1.4.1.7a7.4 7.4 0 0 0 3 2.7c.4.2.6.2.8 0l.9-1.1c.2-.2.4-.2.7-.1l2 1c.3.2.3.4.2.8-.3 1.4-1.4 2.1-2.8 1.8-3.5-.8-7.3-4.1-7.5-7.2 0-1 .4-1.8 1.2-2.3Z"/></>,
  facebook: <path fill="currentColor" stroke="none" d="M13.8 22v-8.9h3l.5-3.5h-3.5V7.4c0-1 .3-1.7 1.8-1.7h1.9V2.6c-.7-.1-1.6-.2-2.7-.2-2.8 0-4.7 1.8-4.7 4.8v2.4H7v3.5h3.1V22Z"/>,
  instagram: <><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.4" cy="6.6" r="1.1" fill="currentColor" stroke="none"/></>,
  tiktok: <path fill="currentColor" stroke="none" d="M13 2h3a5.4 5.4 0 0 0 5 5v3.1a8.2 8.2 0 0 1-5-1.8v7.3a6.3 6.3 0 1 1-6.3-6.3l.9.1v3.2a3.2 3.2 0 1 0 2.4 3.1Z"/>,
  link: <><path d="m9 15 6-6m-5 6.5-1.7 1.7a3.6 3.6 0 1 1-5.1-5.1l3.6-3.6a3.6 3.6 0 0 1 5.1 0m.2 7a3.6 3.6 0 0 0 5.1 0l3.6-3.6a3.6 3.6 0 1 0-5.1-5.1L14 7.5"/></>,
};

export function ChannelIcon({name}:{name:string}) {
  const key = name.toLowerCase();
  return <svg className={styles.icon} aria-hidden="true" focusable="false" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    {Object.hasOwn(symbols,key) ? symbols[key] : symbols.link}
  </svg>;
}
