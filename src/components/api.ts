export class ApiError extends Error {
 constructor(public code:string,message:string,public fields:Record<string,string>={},public status=400){super(message);}
}
export async function api<T>(path:string,body?:unknown,method?:string,key?:string):Promise<T> {
 const response=await fetch(`/api/v1${path}`,{method:method??(body===undefined?"GET":"POST"),credentials:"same-origin",cache:"no-store",headers:{"Content-Type":"application/json",...(key?{"Idempotency-Key":key}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
 const result=await response.json();
 if(!response.ok)throw new ApiError(result.error?.code??"UNKNOWN",result.error?.message??"Request failed",result.error?.fields??{},response.status);
 return result.data as T;
}
