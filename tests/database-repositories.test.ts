import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RendererDatabase } from "@latex-renderer/database";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root,{recursive:true,force:true}); });

function database(): RendererDatabase {
  const root=mkdtempSync(join(tmpdir(),"latex-renderer-repository-"));roots.push(root);
  const db=new RendererDatabase(join(root,"test.sqlite3"));db.migrate();return db;
}

describe("database repositories",()=>{
  it("keeps mutations and audits in one transaction",()=>{
    const db=database();const now=new Date().toISOString();
    db.transaction(()=>{
      db.users.insertInvitation({id:"user_test",email:"owner@example.com",displayName:"Owner",role:"owner",createdBy:"test",timestamp:now});
      db.audit({actorType:"local",actorId:"test",action:"user.created",targetType:"user",targetId:"user_test",result:"success"});
    });
    expect(db.users.get("user_test")).toMatchObject({role:"owner",access_subject:null,access_subject_generation:0});
    expect(db.auditLogs.list()).toHaveLength(1);db.close();
  });

  it("reads and updates typed settings",()=>{
    const db=database();const now=new Date().toISOString();
    db.settings.upsert("max_queue_length",42,"test",now);
    expect(db.settings.value("max_queue_length",0)).toBe(42);db.close();
  });

  it("persists requested output formats with a PDF-only default",()=>{
    const db=database(),now=new Date().toISOString();
    db.raw.prepare(`INSERT INTO users(id,access_subject,email,display_name,role,status,security_version,created_by,created_at,updated_at) VALUES ('user',NULL,'user@example.test','User','user','active',1,'test',?,?)`).run(now,now);
    db.raw.prepare(`INSERT INTO service_accounts(id,owner_user_id,name,client_type,status,security_version,created_at,updated_at) VALUES ('service','user','Service','generic','active',1,?,?)`).run(now,now);
    db.raw.prepare(`INSERT INTO api_keys(id,service_account_id,name,prefix,secret_hash,pepper_id,scopes_json,created_at,created_by) VALUES ('key','service','Key','prefix','hash','v1','["render:create"]',?,'test')`).run(now);
    const common={userId:"user",serviceAccountId:"service",apiKeyId:"key",rendererVersion:"test",sourceSize:1,sourceSha256:"a".repeat(64),timestamp:now,reservedOutputBytes:0};
    db.jobs.insertReserved({id:`job_${"1".repeat(32)}`,...common});
    db.jobs.insertReserved({id:`job_${"2".repeat(32)}`,...common,outputs:["pdf","svg"]});
    const pdfJob=db.jobs.get(`job_${"1".repeat(32)}`),svgJob=db.jobs.get(`job_${"2".repeat(32)}`);
    if (pdfJob === undefined || svgJob === undefined) throw new Error("Expected persisted jobs");
    expect(db.jobs.outputs(pdfJob)).toEqual(["pdf"]);
    expect(db.jobs.outputs(svgJob)).toEqual(["pdf","svg"]);
    db.close();
  });

  it("searches and pages audit logs in the database",()=>{
    const db=database();
    for(let index=0;index<5;index++)db.raw.prepare(`INSERT INTO audit_logs(id,actor_type,actor_id,action,target_type,target_id,result,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?,?)`).run(`audit_${index}`,index%2===0?"user":"system",`actor_${index}`,index<3?"user.updated":"render.completed","job",`job_${index}`,index===4?"failed":"success","{}",`2026-08-09T00:00:0${index}.000Z`);
    expect(db.auditLogs.search({page:2,pageSize:2})).toMatchObject({page:2,pageSize:2,total:5,totalPages:3,items:[{id:"audit_2"},{id:"audit_1"}]});
    expect(db.auditLogs.search({page:1,pageSize:10,action:"user.",actor:"actor_2",result:"success"})).toMatchObject({total:1,items:[{id:"audit_2"}]});
    db.close();
  });
});
