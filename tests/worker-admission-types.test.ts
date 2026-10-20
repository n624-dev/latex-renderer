import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// Ordinary Vitest transforms erase types. Check the actual planning expression
// without loading the workspace, Node types, or the standard library graph.
const worker = readFileSync(
  new URL("../apps/renderer-worker/src/worker.ts", import.meta.url),
  "utf8",
);
const start = worker.indexOf("      const planned = candidates.map(");
const end = worker.indexOf("      if (admission !== previousAdmission)", start);
if (start < 0 || end <= start) throw new Error("Admission planning not found");
const planning = worker.slice(start, end);
const admissionSource = ts.createSourceFile(
  "admission.ts",
  readFileSync(
    new URL("../apps/renderer-worker/src/admission.ts", import.meta.url),
    "utf8",
  ),
  ts.ScriptTarget.ES2023,
  true,
);
const declarations = admissionSource.statements
  .filter(
    (statement) =>
      (ts.isInterfaceDeclaration(statement) &&
        statement.name.text === "HostResources") ||
      (ts.isFunctionDeclaration(statement) &&
        statement.name?.text === "assessHostResources"),
  )
  .map((statement) => statement.getText(admissionSource))
  .join("\n");

function diagnostics(expression: string) {
  const sources = new Map([
    [
      "globals.d.ts",
      `interface Array<T> {
         [index:number]: T;
         map<U>(callback:(value:T)=>U): U[];
         find(predicate:(value:T)=>unknown): T|undefined;
         at(index:number): T|undefined;
       }
       type ReturnType<T extends (...args:any[])=>any> = T extends (...args:any[])=>infer R ? R : never;
       declare const Date: {now():number;parse(value:string):number};`,
    ],
    [
      "planning.ts",
      `${declarations}
       interface Candidate {id:string;queued_at:string}
       declare const candidates: Candidate[];
       declare const resources: HostResources;
       declare const config: {image:string;minimumAvailableMemoryBytes?:number;admissionWaitTimeoutMs?:number};
       declare const database: {worker:{setAdmissionReason(blocked:boolean,time:string,id:string,message:string):void}};
       declare function planRenderMemory(db:unknown,candidate:Candidate|undefined,image:string,minimum:number|undefined): {limit:number;minimum?:number};
       declare function nowIso():string;
       declare function resourceWaitMessage(state:ReturnType<typeof assessHostResources>,resources:HostResources,minimum:number,longWait:boolean):string;
       let admissionAfter: Candidate|undefined;
       let admission: ReturnType<typeof assessHostResources>;
       ${expression}`,
    ],
  ]);
  const options: ts.CompilerOptions = {
    strict: true,
    noUncheckedIndexedAccess: true,
    exactOptionalPropertyTypes: true,
    noLib: true,
    noEmit: true,
    types: [],
    target: ts.ScriptTarget.ES2023,
  };
  const host = ts.createCompilerHost(options);
  host.getSourceFile = (name, languageVersion) => {
    const source = sources.get(name);
    return source === undefined
      ? undefined
      : ts.createSourceFile(name, source, languageVersion, true);
  };
  host.fileExists = (name) => sources.has(name);
  host.readFile = (name) => sources.get(name);
  const program = ts.createProgram([...sources.keys()], options, host);
  return program.getSemanticDiagnostics().map((diagnostic) => ({
    code: diagnostic.code,
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
  }));
}

describe("Worker admission planning types", () => {
  it("preserves the admission-state union across map, find and fallback", () => {
    expect(diagnostics(planning)).toEqual([]);
  });

  it("detects the CI regression even when the local state variable is annotated", () => {
    const widened = planning.replace(
      "return { candidate, plan, state } as const;",
      "return { candidate, plan, state };",
    );
    expect(widened).not.toBe(planning);
    const errors = diagnostics(widened);
    expect(errors.map((error) => error.code)).toEqual([2322]);
    expect(errors[0]?.message).toContain("Type 'string' is not assignable");
  });
});
