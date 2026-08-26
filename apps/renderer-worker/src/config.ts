import { randomUUID } from "node:crypto";
import { loadResourceLimits, type ResourceLimits } from "@latex-renderer/shared";

export interface WorkerConfig extends ResourceLimits { databasePath:string;storageRoot:string;image:string;workerId:string;seccompProfile:string;apparmorProfile:string|undefined;maxOutputBytes:number;maxLogBytes:number;maxSvgObjects:number;maxSvgBytes:number;maxSvgTotalBytes:number;svgConversionTimeoutSeconds:number;containerUid:number;containerGid:number;jobTimeoutMs:number }

export function loadWorkerConfig():WorkerConfig{
  const config:WorkerConfig={...loadResourceLimits(process.env),databasePath:required("DATABASE_PATH"),storageRoot:required("STORAGE_ROOT"),image:required("RENDERER_IMAGE"),workerId:process.env.WORKER_ID??`worker_${randomUUID()}`,seccompProfile:required("RENDERER_SECCOMP_PROFILE"),apparmorProfile:optional("RENDERER_APPARMOR_PROFILE"),maxOutputBytes:Number(process.env.MAX_OUTPUT_BYTES??String(200*1024*1024)),maxLogBytes:Number(process.env.MAX_LOG_BYTES??String(10*1024*1024)),maxSvgObjects:positiveEnvironment("MAX_SVG_OBJECTS",200),maxSvgBytes:positiveEnvironment("MAX_SVG_BYTES",10*1024*1024),maxSvgTotalBytes:positiveEnvironment("MAX_SVG_TOTAL_BYTES",100*1024*1024),svgConversionTimeoutSeconds:positiveEnvironment("SVG_CONVERSION_TIMEOUT_SECONDS",120),containerUid:numericEnvironment("RENDERER_CONTAINER_UID",10000),containerGid:numericEnvironment("RENDERER_CONTAINER_GID",10000),jobTimeoutMs:numericEnvironment("RENDERER_JOB_TIMEOUT_SECONDS",420)*1000};
  if(config.containerUid===0||config.containerGid===0)throw new Error("Renderer container UID and GID must both be non-zero");
  if(!isImmutableImageReference(config.image)&&process.env.ALLOW_MUTABLE_RENDERER_IMAGE!=="true")throw new Error("RENDERER_IMAGE must be an image ID or registry digest; mutable tags are forbidden");
  return config;
}
function required(name:string):string{const value=process.env[name];if(value===undefined||value.length===0)throw new Error(`${name} is required`);return value;}
function optional(name:string):string|undefined{const value=process.env[name];return value===undefined||value.length===0?undefined:value;}
function numericEnvironment(name:string,fallback:number):number{const value=process.env[name];if(value===undefined)return fallback;const parsed=Number(value);if(!Number.isSafeInteger(parsed)||parsed<0)throw new Error(`${name} must be a non-negative integer`);return parsed;}
function positiveEnvironment(name:string,fallback:number):number{const value=numericEnvironment(name,fallback);if(value===0)throw new Error(`${name} must be a positive integer`);return value;}
function isImmutableImageReference(value:string):boolean{return /^sha256:[a-f0-9]{64}$/.test(value)||/@sha256:[a-f0-9]{64}$/.test(value);}
