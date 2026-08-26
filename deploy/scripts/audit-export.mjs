#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync(required("DATABASE_PATH"), { readOnly: true });
const destination=required("BACKUP_DIRECTORY");const recipient=required("BACKUP_AGE_RECIPIENT_FILE");await mkdir(destination,{recursive:true,mode:0o700});
const checkpointPath=process.env.AUDIT_EXPORT_CHECKPOINT??join(destination,"audit-export.checkpoint");
const checkpoint=JSON.parse(await readFile(checkpointPath,"utf8").catch(()=>'{"createdAt":"","id":""}'));
if(typeof checkpoint.createdAt!=="string"||typeof checkpoint.id!=="string")throw new Error("Invalid audit export checkpoint");
const rows=db.prepare(`SELECT id,actor_type,actor_id,action,target_type,target_id,result,ip_address,user_agent,metadata_json,created_at
  FROM audit_logs WHERE created_at>? OR (created_at=? AND id>?) ORDER BY created_at,id LIMIT 100000`).all(checkpoint.createdAt,checkpoint.createdAt,checkpoint.id);db.close();
if(rows.length===0){console.log(JSON.stringify({event:"audit_export.no_changes"}));process.exit(0);}
const work=await mkdtemp(join(tmpdir(),"latex-audit-"));const stamp=new Date().toISOString().replaceAll(":","-");
try{const jsonl=join(work,`audit-${stamp}.jsonl`);await writeFile(jsonl,rows.map((row)=>JSON.stringify(row)).join("\n")+"\n",{mode:0o600});
  const output=join(destination,`${basename(jsonl)}.age`);await run("age",["-R",recipient,"-o",output,jsonl]);if((await stat(output)).size===0)throw new Error("Encrypted audit export is empty");await uploadIfConfigured(output);
  const last=rows.at(-1);await writeFile(checkpointPath,`${JSON.stringify({createdAt:String(last.created_at),id:String(last.id)})}\n`,{mode:0o600});console.log(JSON.stringify({event:"audit_export.completed",count:rows.length,file:output}));
}finally{await rm(work,{recursive:true,force:true});}
async function uploadIfConfigured(path){const executable=process.env.BACKUP_UPLOAD_EXECUTABLE;if(!executable)return;const args=JSON.parse(process.env.BACKUP_UPLOAD_ARGS_JSON??"[]");if(!Array.isArray(args)||!args.every((v)=>typeof v==="string"))throw new Error("BACKUP_UPLOAD_ARGS_JSON must be a string array");await run(executable,[...args,path]);}
function run(command,args){return new Promise((resolvePromise,reject)=>{const child=spawn(command,args,{stdio:["ignore","ignore","pipe"],shell:false});let error="";child.stderr.setEncoding("utf8");child.stderr.on("data",(c)=>{if(error.length<8192)error+=c});child.once("error",reject);child.once("close",(code)=>code===0?resolvePromise():reject(new Error(`${command} failed: ${error}`)));});}
function required(name){const value=process.env[name];if(!value)throw new Error(`${name} is required`);return value;}
