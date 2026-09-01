import { open, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseCompileLog, parseRecorder } from "@latex-renderer/log-parser";

export async function generateMetadata(directory:string,exitCode:number,maxInputBytes:number):Promise<void>{const log=await readBoundedText(join(directory,"compile.log"),maxInputBytes,"Renderer did not produce a compile log");await writeFile(join(directory,"errors.json"),JSON.stringify(parseCompileLog(log,exitCode),null,2),{mode:0o660});const recorder=await readBoundedText(join(directory,"main.fls"),maxInputBytes,"");await writeFile(join(directory,"dependencies.json"),JSON.stringify(parseRecorder(recorder),null,2),{mode:0o660});}

async function readBoundedText(path:string,maxBytes:number,fallback:string):Promise<string>{let handle;try{handle=await open(path,"r");const info=await handle.stat();if(!info.isFile()||info.nlink!==1)throw new Error("Renderer metadata input is not a regular file");if(info.size>maxBytes)throw new Error("Renderer metadata input exceeds limit");const buffer=Buffer.alloc(info.size),result=await handle.read(buffer,0,buffer.length,0);return buffer.subarray(0,result.bytesRead).toString("utf8");}catch(error){if(errorCode(error)==="ENOENT")return fallback;throw error;}finally{await handle?.close();}}
function errorCode(error:unknown):string|undefined{return typeof error==="object"&&error!==null&&"code" in error?String((error as {code?:unknown}).code):undefined;}
