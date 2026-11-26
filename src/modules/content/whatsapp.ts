// Owner-designated public contacts, confirmed 2026-10-25. No invented department labels.
export const teamWhatsAppNumbers=["+201099267451","+201220907478"] as const;

export function whatsappLink(phone:string|null|undefined,draft=""):string|null {
  if(!phone||!/^\+[1-9][0-9]{6,14}$/.test(phone))return null;
  return `https://wa.me/${phone.slice(1)}${draft?`?text=${encodeURIComponent(draft)}`:""}`;
}
