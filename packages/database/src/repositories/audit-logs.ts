import type { DatabaseSync, SQLInputValue } from "node:sqlite";

export interface AuditLogRow { id:string;actor_type:string;actor_id:string;action:string;target_type:string;target_id:string;result:string;ip_address:string|null;user_agent:string|null;metadata_json:string;created_at:string }
export interface AuditLogQuery { page:number;pageSize:number;action?:string|undefined;actor?:string|undefined;target?:string|undefined;result?:string|undefined;from?:string|undefined;to?:string|undefined }
export interface AuditLogPage { items:AuditLogRow[];page:number;pageSize:number;total:number;totalPages:number }

export class AuditLogsRepository {
  constructor(private readonly db: DatabaseSync) {}
  list(limit = 1000): AuditLogRow[] {
    return this.db.prepare(`SELECT id,actor_type,actor_id,action,target_type,target_id,result,ip_address,user_agent,metadata_json,created_at
      FROM audit_logs ORDER BY created_at DESC LIMIT ?`).all(limit) as unknown as AuditLogRow[];
  }

  search(query:AuditLogQuery):AuditLogPage{
    const clauses:string[]=[],values:SQLInputValue[]=[];
    const like=(value:string)=>`%${value.replaceAll("\\","\\\\").replaceAll("%","\\%").replaceAll("_","\\_")}%`;
    if(query.action){clauses.push("action LIKE ? ESCAPE '\\'");values.push(like(query.action));}
    if(query.actor){clauses.push("(actor_type LIKE ? ESCAPE '\\' OR actor_id LIKE ? ESCAPE '\\')");const value=like(query.actor);values.push(value,value);}
    if(query.target){clauses.push("(target_type LIKE ? ESCAPE '\\' OR target_id LIKE ? ESCAPE '\\')");const value=like(query.target);values.push(value,value);}
    if(query.result){clauses.push("result = ?");values.push(query.result);}
    if(query.from){clauses.push("created_at >= ?");values.push(query.from);}
    if(query.to){clauses.push("created_at <= ?");values.push(query.to);}
    const where=clauses.length===0?"":` WHERE ${clauses.join(" AND ")}`;
    const total=(this.db.prepare(`SELECT COUNT(*) AS count FROM audit_logs${where}`).get(...values) as {count:number}).count;
    const offset=(query.page-1)*query.pageSize;
    const items=this.db.prepare(`SELECT id,actor_type,actor_id,action,target_type,target_id,result,ip_address,user_agent,metadata_json,created_at
      FROM audit_logs${where} ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?`).all(...values,query.pageSize,offset) as unknown as AuditLogRow[];
    return{items,page:query.page,pageSize:query.pageSize,total,totalPages:Math.ceil(total/query.pageSize)};
  }
}
