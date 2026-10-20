export async function register(){
  if(process.env.NEXT_RUNTIME!=="nodejs")return;
  const {readEnvironment}=await import("./server/env");
  const target=process.env.APP_ENV??"development";
  if(!["development","test","staging","production"].includes(target))throw new Error("APP_ENV_INVALID");
  readEnvironment(target as "development"|"test"|"staging"|"production");
}
