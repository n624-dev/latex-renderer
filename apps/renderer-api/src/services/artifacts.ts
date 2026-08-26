import { createReadStream } from "node:fs";
import { join, normalize, sep } from "node:path";
import { Readable } from "node:stream";
import { AppError, newId, nowIso } from "@latex-renderer/shared";
import type { RendererApiDependencies } from "../types.js";

export function artifactResponse(deps:RendererApiDependencies,jobId:string,name:string):Response{
  const leased=deps.database.transaction(()=>{const row=deps.database.artifacts.getDownloadable(jobId,name);if(row===undefined)throw new AppError("ARTIFACT_NOT_FOUND","Artifact does not exist",404);const leaseId=newId("download");deps.database.artifacts.createLease({id:leaseId,jobId,artifactId:row.id,expiresAt:new Date(Date.now()+300_000).toISOString(),createdAt:nowIso()});return{row,leaseId};});
  const {row,leaseId}=leased,normalized=normalize(row.relative_path);if(normalized.startsWith("..")||normalized.includes(`${sep}..${sep}`)||normalized!==name){deps.database.artifacts.deleteLease(leaseId);throw new AppError("ARTIFACT_PATH_INVALID","Stored artifact path is invalid");}
  const input=createReadStream(join(deps.storageRoot,"jobs",jobId,"output",normalized));let cleaned=false;const cleanup=()=>{if(cleaned)return;cleaned=true;deps.database.artifacts.deleteLease(leaseId);};input.once("close",cleanup);input.once("error",cleanup);input.once("end",cleanup);
  const digestBase64=Buffer.from(row.sha256,"hex").toString("base64");
  return new Response(Readable.toWeb(input) as ReadableStream,{headers:{"Content-Type":contentType(row.type),"Content-Length":String(row.size),"Content-Digest":`sha-256=:${digestBase64}:`,"X-Artifact-SHA256":row.sha256,"Content-Disposition":row.type==="preview"?"inline":`attachment; filename="${name.split("/").at(-1)?.replaceAll('"',"")??"artifact"}"`,"Cache-Control":"private, no-store, no-cache, max-age=0, must-revalidate","Cloudflare-CDN-Cache-Control":"no-store","CDN-Cache-Control":"no-store","Pragma":"no-cache","Expires":"0","X-Content-Type-Options":"nosniff"}});
}
function contentType(type:string):string{if(type==="pdf")return"application/pdf";if(type==="preview")return"image/png";if(type==="svg")return"image/svg+xml";if(type==="errors"||type==="dependencies"||type==="svg_manifest")return"application/json; charset=utf-8";return"text/plain; charset=utf-8";}
