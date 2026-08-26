import type { RendererDatabase, WorkerJobRow } from "@latex-renderer/database";
import { nowIso } from "@latex-renderer/shared";

export function claimNextJob(database:RendererDatabase,workerId:string):WorkerJobRow|undefined{return database.transaction(()=>{const now=nowIso();return database.worker.claimNext(workerId,now,new Date(Date.now()+30_000).toISOString());});}
