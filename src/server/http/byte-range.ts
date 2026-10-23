/** A single bounded HTTP byte range. Multipart ranges are deliberately unsupported. */
export function byteRange(header:string|null,size:number):{start:number;end:number}|null|"invalid" {
 if(!header)return null;
 const match=/^bytes=(\d*)-(\d*)$/.exec(header);
 if(!match||(!match[1]&&!match[2])||size<=0)return "invalid";
 const first=match[1]?Number(match[1]):undefined,last=match[2]?Number(match[2]):undefined;
 if((first!==undefined&&!Number.isSafeInteger(first))||(last!==undefined&&!Number.isSafeInteger(last)))return "invalid";
 const start=first??Math.max(0,size-(last??0)),end=first===undefined?size-1:Math.min(last??size-1,size-1);
 if(start<0||start>=size||end<start)return "invalid";
 return {start,end};
}

export function mediaResponse(request:Request,bytes:Buffer,mimeType:string,baseHeaders:Record<string,string>) {
 const range=byteRange(request.headers.get("range"),bytes.length),headers=new Headers({...baseHeaders,"Content-Type":mimeType,"Accept-Ranges":"bytes","X-Content-Type-Options":"nosniff"});
 if(range==="invalid"){headers.set("Content-Range",`bytes */${bytes.length}`);return new Response(null,{status:416,headers});}
 const start=range?.start??0,end=range?.end??bytes.length-1;
 headers.set("Content-Length",String(end-start+1));
 if(range)headers.set("Content-Range",`bytes ${start}-${end}/${bytes.length}`);
 return new Response(request.method==="HEAD"?null:new Uint8Array(bytes.subarray(start,end+1)),{status:range?206:200,headers});
}
