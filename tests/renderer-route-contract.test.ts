import { describe,expect,it } from "vitest";
import { createRendererApp } from "../apps/renderer-api/src/app.js";

describe("renderer route contract",()=>{
  it("supports canonical and legacy prefixes",async()=>{
    const app=createRendererApp({database:{} as never,tickets:{} as never,storageRoot:"/tmp",maxUploadBytes:1,minFreeStorageBytes:1,artifactRetentionHours:24});
    for(const path of ["/api/v1/jobs/not-a-job","/v1/jobs/not-a-job"]){const response=await app.request(path);expect(response.status).toBe(400);}
  });
  it("does not expose client distribution from renderer API",async()=>{const app=createRendererApp({database:{} as never,tickets:{} as never,storageRoot:"/tmp",maxUploadBytes:1,minFreeStorageBytes:1,artifactRetentionHours:24});expect((await app.request("/client/")).status).toBe(404);});
});
