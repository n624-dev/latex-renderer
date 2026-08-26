#!/usr/bin/env node
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

const databasePath = required("DATABASE_PATH"); const destination = required("BACKUP_DIRECTORY");
const recipientFile = required("BACKUP_AGE_RECIPIENT_FILE"); await mkdir(destination, { recursive: true, mode: 0o700 });
const work = await mkdtemp(join(tmpdir(), "latex-renderer-backup-"));
const stamp = new Date().toISOString().replaceAll(":", "-"); const snapshot = join(work, "renderer.sqlite3");
try {
  const db = new DatabaseSync(databasePath); db.exec("PRAGMA busy_timeout=30000; PRAGMA wal_checkpoint(FULL)");
  db.prepare("VACUUM INTO ?").run(snapshot); db.close();
  const snapshotStat = await stat(snapshot); const digest = await sha256(snapshot);
  await writeFile(join(work, "manifest.json"), `${JSON.stringify({ format: 1, createdAt: new Date().toISOString(),
    database: { name: "renderer.sqlite3", size: snapshotStat.size, sha256: digest }, artifactsIncluded: false }, null, 2)}\n`, { mode: 0o600 });
  const tarPath = join(work, `latex-renderer-${stamp}.tar`); await run("tar", ["-C", work, "-cf", tarPath, "renderer.sqlite3", "manifest.json"]);
  const output = join(destination, `${basename(tarPath)}.age`); await run("age", ["-R", recipientFile, "-o", output, tarPath]);
  if ((await stat(output)).size === 0) throw new Error("Encrypted backup is empty");
  await uploadIfConfigured(output); console.log(JSON.stringify({ event: "backup.completed", file: output }));
} finally { await rm(work, { recursive: true, force: true }); }

async function sha256(path) { const hash=createHash("sha256"); for await (const chunk of createReadStream(path)) hash.update(chunk); return hash.digest("hex"); }
async function uploadIfConfigured(path) { const executable=process.env.BACKUP_UPLOAD_EXECUTABLE; if(!executable)return; const args=JSON.parse(process.env.BACKUP_UPLOAD_ARGS_JSON??"[]"); if(!Array.isArray(args)||!args.every((v)=>typeof v==="string"))throw new Error("BACKUP_UPLOAD_ARGS_JSON must be a string array"); await run(executable,[...args,path]); }
function run(command,args){return new Promise((resolvePromise,reject)=>{const child=spawn(command,args,{stdio:["ignore","ignore","pipe"],shell:false});let error="";child.stderr.setEncoding("utf8");child.stderr.on("data",(c)=>{if(error.length<8192)error+=c});child.once("error",reject);child.once("close",(code)=>code===0?resolvePromise():reject(new Error(`${command} failed: ${error}`)));});}
function required(name){const value=process.env[name];if(!value)throw new Error(`${name} is required`);return value;}
