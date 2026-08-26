#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { DatabaseSync } from "node:sqlite";
const archive=process.argv[2];if(!archive)throw new Error("usage: restore-test.mjs BACKUP.tar.age");
const identity=required("BACKUP_AGE_IDENTITY_FILE");const work=await mkdtemp(join(tmpdir(),"latex-restore-test-"));
try{const tarPath=join(work,"backup.tar");await run("age",["-d","-i",identity,"-o",tarPath,archive]);await run("tar",["-C",work,"-xf",tarPath]);
  const manifest=JSON.parse(await readFile(join(work,"manifest.json"),"utf8"));const dbPath=join(work,"renderer.sqlite3");const info=await stat(dbPath);
  if(info.size!==manifest.database.size||await sha256(dbPath)!==manifest.database.sha256)throw new Error("Backup manifest mismatch");
  const db=new DatabaseSync(dbPath,{readOnly:true});const result=db.prepare("PRAGMA integrity_check").all();const migrations=db.prepare("SELECT version,applied_at FROM schema_migrations ORDER BY version").all();db.close();
  if(result.length!==1||result[0].integrity_check!=="ok")throw new Error("SQLite integrity_check failed");console.log(JSON.stringify({event:"restore_test.completed",migrations}));
}finally{await rm(work,{recursive:true,force:true});}
async function sha256(path){const hash=createHash("sha256");for await(const chunk of createReadStream(path))hash.update(chunk);return hash.digest("hex");}
function run(command,args){return new Promise((resolvePromise,reject)=>{const child=spawn(command,args,{stdio:["ignore","ignore","pipe"],shell:false});let error="";child.stderr.setEncoding("utf8");child.stderr.on("data",(c)=>error+=c);child.once("error",reject);child.once("close",(code)=>code===0?resolvePromise():reject(new Error(`${command} failed: ${error.slice(0,8192)}`)));});}
function required(name){const value=process.env[name];if(!value)throw new Error(`${name} is required`);return value;}
