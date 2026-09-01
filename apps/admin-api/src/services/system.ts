import { AppError, nowIso } from "@latex-renderer/shared";
import type { MaintenanceMode } from "@latex-renderer/contracts";
import type { AdminActor, AdminDependencies } from "../types.js";
import type { AuditLogQuery } from "@latex-renderer/database";

export const ticketRevocationMinimumSeconds=35*60;

export class AdminSystemService {
  constructor(private readonly deps:AdminDependencies){}

  status(){return{writeEnabled:this.deps.writeEnabled,maintenance:this.deps.database.settings.get("maintenance_mode"),worker:this.deps.database.settings.get("worker_mode"),rendering:this.renderingHealth(),jobs:this.deps.database.jobs.statusCounts()};}
  config(){return this.deps.database.settings.listMutable();}
  audit(query:AuditLogQuery){return this.deps.database.auditLogs.search(query);}
  ticketKeys(){return{activeKid:this.deps.activeTicketKid,verificationKids:this.deps.verificationTicketKids,minRevocationSeconds:ticketRevocationMinimumSeconds};}
  renderingHealth(){
    const heartbeat=this.deps.database.settings.value<{workerId:string;at:string;stopping?:boolean}|null>("worker_heartbeat",null),mode=this.deps.database.settings.value<string>("worker_mode","running"),age=heartbeat===null?Infinity:Date.now()-Date.parse(heartbeat.at),fresh=Number.isFinite(age)&&age<=30_000&&heartbeat?.stopping!==true;
    return{operational:fresh&&mode==="running",mode,fresh,lastHeartbeatAt:heartbeat?.at??null};
  }

  updateConfig(actor:AdminActor,input:{key:"max_queue_length"|"max_user_storage_bytes"|"max_user_active_jobs"|"source_orphan_retention_minutes";value:number;reason:string}):void{
    const bounds=input.key==="max_queue_length"?{min:1,max:10000}:input.key==="max_user_storage_bytes"?{min:100*1024*1024,max:100*1024*1024*1024}:input.key==="max_user_active_jobs"?{min:1,max:1000}:{min:5,max:1440};
    if(input.value<bounds.min||input.value>bounds.max)throw new AppError("CONFIG_OUT_OF_RANGE","Configuration value is outside its safe range",400);
    const previous=this.deps.database.settings.value<number|null>(input.key,null);
    if(typeof previous==="number"&&input.value>previous&&actor.role!=="owner")throw new AppError("OWNER_REQUIRED","Only an owner can relax resource limits",403);
    this.deps.database.transaction(()=>{
      this.deps.database.settings.upsert(input.key,input.value,actor.id,nowIso());
      this.deps.database.audit({actorType:actor.type,actorId:actor.id,action:"system.config_updated",targetType:"system_setting",targetId:input.key,result:"success",metadata:{oldValue:previous,newValue:input.value,reason:input.reason,restartRequired:false}});
    });
  }

  maintenance(actor:AdminActor,action:"enable"|"disable",mode:MaintenanceMode,reason?:string):MaintenanceMode{
    if(action==="enable"&&(reason===undefined||reason.trim()===""))throw new AppError("MAINTENANCE_REASON_REQUIRED","Maintenance reason is required",400);
    const actual:MaintenanceMode=action==="disable"?"normal":mode;this.deps.database.transaction(()=>{
      this.deps.database.settings.upsert("maintenance_mode",actual,actor.id,nowIso());
      this.deps.database.audit({actorType:actor.type,actorId:actor.id,action:`maintenance.${action}d`,targetType:"system",targetId:"maintenance",result:"success",metadata:{mode:actual,...(reason===undefined?{}:{reason:reason.trim()})}});
    });return actual;
  }

  worker(actor:AdminActor,action:"pause"|"resume"|"drain"):string{
    const mode=action==="resume"?"running":action==="pause"?"paused":"draining";this.deps.database.transaction(()=>{
      this.deps.database.settings.upsert("worker_mode",mode,actor.id,nowIso());
      this.deps.database.audit({actorType:actor.type,actorId:actor.id,action:action==="pause"?"worker.paused":action==="resume"?"worker.resumed":"worker.drained",targetType:"system",targetId:"worker",result:"success"});
    });return mode;
  }

  revokeTicketKey(actor:AdminActor,kid:string,input:{reason:string;expiresAt:string}):void{
    if(actor.role!=="owner")throw new AppError("OWNER_REQUIRED","Only an owner can revoke a ticket signing key",403);
    if(!/^[A-Za-z0-9._-]{1,100}$/.test(kid))throw new AppError("INVALID_KEY_ID","Ticket key id is invalid",400);
    if(kid===this.deps.activeTicketKid)throw new AppError("ACTIVE_KEY_REVOCATION_FORBIDDEN","Switch the active signing key before revoking the previous key",409);
    if(!this.deps.verificationTicketKids.includes(kid))throw new AppError("TICKET_KEY_NOT_CONFIGURED","Ticket key is not configured as a verification key",404);
    if(Date.parse(input.expiresAt)<Date.now()+ticketRevocationMinimumSeconds*1000)throw new AppError("INVALID_EXPIRY","Revocation must cover the 30 minute ticket lifetime and 5 minute clock skew",400);
    this.deps.database.transaction(()=>{
      this.deps.database.security.revokeTicketKey(kid,input.reason,input.expiresAt,nowIso());
      this.deps.database.audit({actorType:actor.type,actorId:actor.id,action:"ticket_key.revoked",targetType:"ticket_key",targetId:kid,result:"success",metadata:{expiresAt:input.expiresAt}});
    });
  }
}
