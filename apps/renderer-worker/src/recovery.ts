import type { RendererDatabase } from "@latex-renderer/database";
import { nowIso } from "@latex-renderer/shared";
import type { WorkerConfig } from "./config.js";
import { dockerStop, runDocker } from "./docker.js";

export async function recoverStaleLeases(database:RendererDatabase,config:WorkerConfig):Promise<void>{for(const job of database.worker.staleLeases(nowIso())){const containerName=`latex-render-${job.id}`,exists=(await runDocker(["ps","-aq","--filter",`name=^/${containerName}$`]).catch(()=>"")).trim().length>0;if(exists)await dockerStop(containerName);const timestamp=nowIso();database.transaction(()=>{if(exists)database.worker.recoverFailed(job.id,timestamp);else database.worker.recoverQueued(job.id,timestamp);database.audit({actorType:"system",actorId:config.workerId,action:"render.lease_recovered",targetType:"job",targetId:job.id,result:exists?"failed":"success",metadata:{previousStatus:job.status,containerFound:exists}});});}}
