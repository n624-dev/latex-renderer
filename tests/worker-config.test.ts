import { afterEach,describe,expect,it,vi } from "vitest";
import { loadWorkerConfig } from "../apps/renderer-worker/src/config.js";
import { rendererRunArguments,validateDockerIsolation } from "../apps/renderer-worker/src/docker.js";
afterEach(()=>vi.unstubAllEnvs());
describe("renderer worker config",()=>{
  it("rejects mutable images",()=>{stubRequiredEnvironment("latest");vi.stubEnv("ALLOW_MUTABLE_RENDERER_IMAGE","");expect(()=>loadWorkerConfig()).toThrow(/immutable|mutable tags/);});
  it("uses a 420 second job timeout and no AppArmor profile by default",()=>{stubRequiredEnvironment();vi.stubEnv("RENDERER_APPARMOR_PROFILE","");const config=loadWorkerConfig();expect(config.jobTimeoutMs).toBe(420_000);expect(config.apparmorProfile).toBeUndefined();});
  it("loads one validated ZIP limit set for worker extraction",()=>{stubRequiredEnvironment();vi.stubEnv("MAX_UPLOAD_BYTES","1024");vi.stubEnv("MAX_EXTRACTED_BYTES","4096");vi.stubEnv("MAX_FILE_COUNT","7");vi.stubEnv("MAX_ZIP_ENTRIES","9");expect(loadWorkerConfig()).toMatchObject({maxUploadBytes:1024,maxExtractedBytes:4096,maxFileCount:7,maxZipEntries:9});});
  it("rejects contradictory ZIP limits at startup",()=>{stubRequiredEnvironment();vi.stubEnv("MAX_FILE_COUNT","10");vi.stubEnv("MAX_ZIP_ENTRIES","9");expect(()=>loadWorkerConfig()).toThrow(/MAX_ZIP_ENTRIES/);});
  it("rejects disabled SVG safety limits",()=>{stubRequiredEnvironment();vi.stubEnv("MAX_SVG_OBJECTS","0");expect(()=>loadWorkerConfig()).toThrow(/integer from 1/);});
  it("does not pass an AppArmor option for the rootless production configuration",()=>{stubRequiredEnvironment();vi.stubEnv("RENDERER_APPARMOR_PROFILE","");const args=rendererRunArguments(loadWorkerConfig(),"job_test","/input","/output");expect(args).not.toContain("apparmor=latex-renderer");expect(args).toContain("seccomp=/tmp/seccomp");});
  it("names renderer containers by fenced lease generation",()=>{stubRequiredEnvironment();const args=rendererRunArguments(loadWorkerConfig(),"job_test","/input","/output","main.tex",["pdf"],7);expect(args).toContain("latex-render-job_test-g7");expect(args).toContain("latex-renderer.lease-generation=7");});
  it("rejects AppArmor when Docker is rootless",()=>{expect(()=>validateDockerIsolation('["name=seccomp","name=rootless"]',"latex-renderer",false)).toThrow(/unsupported by rootless/);});
  it("accepts the hardened rootless production options",()=>{expect(()=>validateDockerIsolation('["name=seccomp","name=rootless","name=cgroupns"]',undefined,false)).not.toThrow();});
  it("requires AppArmor support when a rootful development daemon is explicitly allowed",()=>{expect(()=>validateDockerIsolation('["name=seccomp"]',"latex-renderer",true)).toThrow(/does not support AppArmor/);expect(()=>validateDockerIsolation('["name=apparmor","name=seccomp"]',"latex-renderer",true)).not.toThrow();});
});

function stubRequiredEnvironment(image="sha256:"+"a".repeat(64)):void{vi.stubEnv("DATABASE_PATH","/tmp/db");vi.stubEnv("STORAGE_ROOT","/tmp/storage");vi.stubEnv("RENDERER_IMAGE",image);vi.stubEnv("RENDERER_SECCOMP_PROFILE","/tmp/seccomp");}
