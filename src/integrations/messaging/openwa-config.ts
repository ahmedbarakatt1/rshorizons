/** The gateway origin is operator configuration, never a browser-supplied destination. */
export function openWaOrigin(source:Record<string,string|undefined>=process.env){
  const url=new URL(source.OPENWA_BASE_URL??"");
  const local=["development","test"].includes(source.APP_ENV??"")&&["127.0.0.1","localhost","[::1]"].includes(url.hostname);
  if((url.protocol!=="https:"&&!(local&&url.protocol==="http:"))||url.username||url.password||url.search||url.hash||url.pathname!=="/"||(!local&&["127.0.0.1","localhost","[::1]"].includes(url.hostname)))throw new Error("OPENWA_BASE_URL_INVALID");
  return url.origin;
}
export function openWaSession(source:Record<string,string|undefined>=process.env){
  const session=source.OPENWA_SESSION_ID??"";
  if(!/^[A-Za-z0-9_-]{1,100}$/.test(session))throw new Error("OPENWA_SESSION_ID_INVALID");
  return session;
}
