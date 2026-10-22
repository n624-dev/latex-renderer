import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServiceAccountsService } from "../apps/admin-api/src/services/service-accounts.js";
import * as docker from "../apps/renderer-worker/src/docker.js";
import * as processor from "../apps/renderer-worker/src/job-processor.js";
import * as admission from "../apps/renderer-worker/src/admission.js";
import { runWorker } from "../apps/renderer-worker/src/worker.js";
import {
  MIB,
  memoryProfileKey,
  rememberRenderMemory,
  planRenderMemory,
} from "../apps/renderer-worker/src/memory-plan.js";
import {
  pipelineDocument,
  realPipelineImage,
  sourcePipelineFixture,
} from "./helpers/source-pipeline.js";

const identity = {
  userId: "pipeline_user",
  scopes: ["mcp:render", "mcp:read"] as const,
};
afterEach(() => vi.restoreAllMocks());

describe.skipIf(realPipelineImage !== undefined)(
  "Issue 223 deterministic regressions (no TeX)",
  () => {
    it("invalidates insufficient SVG memory profiles while preserving the published PDF", async () => {
      const f = await sourcePipelineFixture();
      try {
        const abort = new AbortController();
        const job = await f.renders.createRender(identity, {
          inlineSource: pipelineDocument(),
          outputs: ["pdf", "svg"],
        });
        const candidate = f.database.worker.admissionCandidates()[0];
        if (!candidate) throw new Error("Missing admission candidate");
        expect(candidate.id).toBe(job.id);
        rememberRenderMemory(
          f.database,
          memoryProfileKey(candidate, f.config.image),
          191 * MIB,
          true,
        );
        f.config.minimumAvailableMemoryBytes = 832 * MIB;
        vi.spyOn(docker, "assertDockerIsolation").mockResolvedValue();
        vi.spyOn(admission, "readHostResources").mockReturnValue({
          availableBytes: 2048 * MIB,
          memoryStallPercent: 0,
          ioStallPercent: 0,
        });
        const actual = processor.processJob;
        vi.spyOn(processor, "processJob").mockImplementation(
          async (...args) => {
            try {
              await actual(...args);
            } finally {
              abort.abort();
            }
          },
        );
        f.failNextSvg(84);
        await runWorker(f.database, f.config, abort.signal);
        expect(f.database.jobs.get(job.id)?.error_code).toBe(
          "SVG_MEMORY_LIMIT",
        );
        expect(f.database.outputStages.publicState(job.id)?.pdf.status).toBe(
          "succeeded",
        );
        expect(
          planRenderMemory(f.database, candidate, f.config.image, 832 * MIB)
            .estimatedPeak,
        ).toBeNull();
      } finally {
        await f.close();
      }
    });

    it.each(["read-only", "lockdown", "unknown-mode"])(
      "rejects Source reservations and MCP writes during %s",
      async (mode) => {
        const f = await sourcePipelineFixture();
        try {
          f.database.settings.upsert(
            "maintenance_mode",
            mode,
            "fixture",
            new Date().toISOString(),
          );
          await expect(
            f.client.createSource(7, "a".repeat(64), randomUUID()),
          ).rejects.toMatchObject({ code: "MAINTENANCE" });
          await expect(
            f.renders.createSource(identity, [
              { path: "main.tex", text: pipelineDocument() },
            ]),
          ).rejects.toMatchObject({ code: "MAINTENANCE" });
          await expect(
            f.renders.beginSourceUpload(identity, 7, "a".repeat(64)),
          ).rejects.toMatchObject({ code: "MAINTENANCE" });
          expect(
            f.database.raw.prepare("SELECT COUNT(*) AS n FROM sources").get(),
          ).toMatchObject({ n: 0 });
        } finally {
          await f.close();
        }
      },
    );

    it("allows Source preparation in reject-new-jobs without permitting rendering", async () => {
      const f = await sourcePipelineFixture();
      try {
        f.database.settings.upsert(
          "maintenance_mode",
          "reject-new-jobs",
          "fixture",
          new Date().toISOString(),
        );
        const source = await f.renders.createSource(identity, [
          { path: "main.tex", text: pipelineDocument() },
        ]);
        expect(source.id).toMatch(/^source_/);
        await expect(
          f.client.createSource(7, "a".repeat(64), randomUUID()),
        ).resolves.toMatchObject({ uploadRequired: true });
        await expect(
          f.renders.createRender(identity, {
            inlineSource: pipelineDocument(),
          }),
        ).rejects.toMatchObject({ code: "MAINTENANCE" });
      } finally {
        await f.close();
      }
    });

    it("enforces the active account cap on re-enable but permits idempotent enable", async () => {
      const f = await sourcePipelineFixture();
      try {
        const service = new ServiceAccountsService({
          database: f.database,
        } as ConstructorParameters<typeof ServiceAccountsService>[0]);
        const actor = {
          type: "user",
          id: identity.userId,
          role: "owner",
          userId: identity.userId,
        } as const;
        const ids: string[] = [];
        while (
          f.database.serviceAccounts.countActiveForOwner(identity.userId) < 20
        )
          ids.push(
            service.create(actor, {
              ownerUserId: identity.userId,
              name: `Fixture ${ids.length}`,
              clientType: "generic",
            }),
          );
        const disabled = ids[0];
        if (!disabled) throw new Error("Missing fixture account");
        service.changeStatus(actor, disabled, "disable");
        const replacement = service.create(actor, {
          ownerUserId: identity.userId,
          name: "Replacement",
          clientType: "generic",
        });
        expect(() =>
          service.changeStatus(actor, disabled, "enable"),
        ).toThrowError(
          expect.objectContaining({ code: "SERVICE_ACCOUNT_LIMIT" }),
        );
        expect(f.database.serviceAccounts.get(disabled)?.status).toBe(
          "disabled",
        );
        expect(() =>
          service.changeStatus(actor, replacement, "enable"),
        ).not.toThrow();
        expect(
          f.database.serviceAccounts.countActiveForOwner(identity.userId),
        ).toBe(20);
        service.changeStatus(actor, replacement, "disable");
        expect(service.changeStatus(actor, disabled, "enable").status).toBe(
          "active",
        );
      } finally {
        await f.close();
      }
    });
  },
);
