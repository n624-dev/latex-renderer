import { mkdir } from "node:fs/promises";
import { serve } from "@hono/node-server";
import { RendererDatabase } from "@latex-renderer/database";
import { loadSigningKeyRing, TicketService } from "@latex-renderer/ticket";
import { loadResourceLimits } from "@latex-renderer/shared";
import { createRendererApp } from "./app.js";

function required(name:string):string{const value=process.env[name];if(value===undefined||value.length===0)throw new Error(`${name} is required`);return value;}
function positive(name:string,fallback:number):number{const value=Number(process.env[name]??fallback);if(!Number.isSafeInteger(value)||value<=0)throw new Error(`${name} must be a positive integer`);return value;}

const storageRoot=required("STORAGE_ROOT");await mkdir(storageRoot,{recursive:true,mode:0o770});
const database=new RendererDatabase(required("DATABASE_PATH"));database.migrate();
const signingKid=process.env.TICKET_SIGNING_KID??"v1",signingKeys=loadSigningKeyRing(signingKid,process.env.TICKET_SIGNING_KEY_DIR,process.env.TICKET_SIGNING_KEY_FILE);
const tickets=new TicketService(database,"latex-renderer","latex-render",signingKeys.active,signingKeys.verification);
const app=createRendererApp({database,tickets,storageRoot,...loadResourceLimits(process.env),minFreeStorageBytes:Number(process.env.MIN_FREE_STORAGE_BYTES??String(5*1024*1024*1024)),artifactRetentionHours:positive("ARTIFACT_RETENTION_HOURS",24)});
const port=Number(process.env.PORT??"3100");serve({fetch:app.fetch,hostname:"127.0.0.1",port},info=>{console.log(JSON.stringify({event:"renderer_api.started",address:info.address,port:info.port}));});
