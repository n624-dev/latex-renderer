import type { ClientDistribution } from "./client-distribution.js";
import type { WebConfig } from "./config.js";

export interface StatusSnapshot { api:boolean;rendering:boolean;downloads:boolean;checkedAt:string }
export type StatusProbe=()=>Promise<StatusSnapshot>;

export function createStatusProbe(config:WebConfig,distribution:ClientDistribution):StatusProbe{
  return async()=>{
    const [api,rendering]=await Promise.all([healthy(new URL("/api/v1/health",config.publicOrigin).toString(),config.statusProbeTimeoutMs),healthy(config.renderingHealthUrl,config.statusProbeTimeoutMs)]);
    return{api,rendering,downloads:distribution.archive.byteLength>0&&distribution.manifest.byteLength>0&&distribution.installer.byteLength>0,checkedAt:new Date().toISOString()};
  };
}

async function healthy(url:string,timeoutMs:number):Promise<boolean>{
  try{const response=await fetch(url,{redirect:"manual",signal:AbortSignal.timeout(timeoutMs),headers:{Accept:"application/json"}});return response.ok;}
  catch{return false;}
}
