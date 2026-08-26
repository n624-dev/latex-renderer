import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseCompileLog, parseRecorder } from "@latex-renderer/log-parser";

export async function generateMetadata(directory:string,exitCode:number):Promise<void>{const log=await readFile(join(directory,"compile.log"),"utf8").catch(()=>"Renderer did not produce a compile log");await writeFile(join(directory,"errors.json"),JSON.stringify(parseCompileLog(log.slice(0,10*1024*1024),exitCode),null,2),{mode:0o660});const recorder=await readFile(join(directory,"main.fls"),"utf8").catch(()=>"");await writeFile(join(directory,"dependencies.json"),JSON.stringify(parseRecorder(recorder),null,2),{mode:0o660});}
