/** One explicit browser origin policy for API, admission HTTP and WebSockets. */
export function configuredOrigins(production:boolean, override?:string[]){
  const configured=override??(production?[process.env.WEB_ORIGIN??""]:[process.env.WEB_ORIGIN??`http://localhost:${process.env.WEB_PORT||3000}`,`http://127.0.0.1:${process.env.WEB_PORT||3000}`]);
  if(!configured.length)throw new Error("At least one frontend origin is required.");
  return [...new Set(configured.map(value=>{let url:URL;try{url=new URL(value);}catch{throw new Error("Configure an exact frontend WEB_ORIGIN.");}if(value!==url.origin||(production&&url.protocol!=="https:")||!['http:','https:'].includes(url.protocol))throw new Error("Production WEB_ORIGIN must be an exact HTTPS origin.");return url.origin;}))];
}
export function acceptsOrigin(origin:string|null|undefined,origins:readonly string[],production:boolean){return origin?origins.includes(origin):!production;}
