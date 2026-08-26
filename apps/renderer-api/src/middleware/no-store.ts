import type { Hono } from "hono";

export function installNoStore(app:Hono):void{
  app.use("*",async(c,next)=>{setNoStoreHeaders(c.header.bind(c));await next();});
}

export function setNoStoreHeaders(header:(name:string,value:string)=>void):void{
  header("Cache-Control","private, no-store, no-cache, max-age=0, must-revalidate");
  header("Cloudflare-CDN-Cache-Control","no-store");
  header("CDN-Cache-Control","no-store");
  header("Pragma","no-cache");
  header("Expires","0");
}
