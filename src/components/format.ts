export function money(amount:string,currency:string,locale:string) {
 const value=BigInt(amount); const exponent=new Intl.NumberFormat(locale,{style:"currency",currency}).resolvedOptions().maximumFractionDigits ?? 2;
 const divisor=10n**BigInt(exponent); const whole=value/divisor;const cents=(value%divisor).toString().padStart(exponent,"0");
 return new Intl.NumberFormat(locale,{style:"currency",currency,minimumFractionDigits:exponent,maximumFractionDigits:exponent}).formatToParts(whole).map(part=>part.type==="fraction"?cents:part.value).join("");
}
export function cairoDate(value:string,locale:string) {return new Intl.DateTimeFormat(locale,{dateStyle:"medium",timeStyle:"short",timeZone:"Africa/Cairo"}).format(new Date(value));}
export function cairoInstant(local:string) {
 const wanted=Date.parse(`${local}:00Z`);
 let instant=wanted;
 for(let pass=0;pass<3;pass++) {
  const p=Object.fromEntries(new Intl.DateTimeFormat("en-CA",{timeZone:"Africa/Cairo",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"}).formatToParts(new Date(instant)).map(v=>[v.type,v.value]));
  const represented=Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);
  const delta=wanted-represented;if(delta===0)return new Date(instant).toISOString();instant+=delta;
 }
 throw new Error("This local time does not exist. Choose a different time.");
}
