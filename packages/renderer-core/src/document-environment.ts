import { open } from "node:fs/promises";
import { join } from "node:path";
import {
  documentProbeSchema,
  type DocumentProbe,
  type RenderEngine,
} from "@latex-renderer/contracts";
import { getAuthoringGuide } from "@latex-renderer/contracts/authoring-guide";
import {
  assertRenderAvailable,
  type ProjectActor,
  type RendererDatabase,
} from "@latex-renderer/database";
import { AppError, nowIso, sha256Hex } from "@latex-renderer/shared";
import {
  DocumentRequirementInventory,
  requirementsFingerprint,
  staticEntrypointRequirements,
  type DocumentRequirement,
} from "./document-requirements.js";
import type { RendererEnvironment } from "./environment.js";
import type { RendererSavedSources } from "./saved-sources.js";

export async function rendererCapabilities(
  environment: RendererEnvironment,
  serverVersion: string,
  attachmentImport: boolean,
) {
  return {
    capabilities: {
      ...(await environment.verifiedCapabilities()),
      serverVersion,
      contractVersion: 2 as const,
      attachmentImport,
      guideVersion: (await getAuthoringGuide("overview")).version,
    },
  };
}

export class RendererDocumentEnvironment {
  constructor(
    private readonly database: RendererDatabase,
    private readonly environmentRoot: string,
    private readonly rendererVersion: string,
    private readonly environment: RendererEnvironment,
    private readonly savedSources: () => RendererSavedSources,
  ) {}

  async listAuthoringProfiles() {
    return {
      profiles: [
        await this.taggedJapaneseProfile(
          sha256Hex((await getAuthoringGuide("japanese-tagged")).body),
        ),
      ],
    };
  }

  private async taggedJapaneseProfile(fixtureSha256: string) {
    const runtimeDigest = this.environment.capabilities().runtimeDigest;
    let verified = false;
    if (runtimeDigest !== null) {
      try {
        const file = await open(
          join(this.environmentRoot, "authoring-profiles.json"),
          "r",
        );
        try {
          const info = await file.stat();
          if (info.isFile() && info.size <= 4096) {
            const bytes = Buffer.alloc(info.size);
            if ((await file.read(bytes)).bytesRead === info.size) {
              const value = JSON.parse(bytes.toString("utf8")) as {
                schemaVersion?: number;
                runtimeImage?: string;
                profile?: string;
                fixtureSha256?: string;
                machineChecks?: unknown;
              } | null;
              verified =
                value?.schemaVersion === 1 &&
                value.runtimeImage === this.rendererVersion &&
                value.profile === "tagged-ja-v1" &&
                value.fixtureSha256 === fixtureSha256 &&
                Array.isArray(value.machineChecks) &&
                ["pdf-structure", "tagged", "japanese-text"].every((check) =>
                  (value.machineChecks as unknown[]).includes(check),
                );
            }
          }
        } finally {
          await file.close();
        }
      } catch {
        // Missing or stale evidence leaves this profile unavailable.
      }
    }
    return {
      id: "tagged-ja-v1",
      runtimeDigest,
      fixtureSha256,
      engine: "lualatex" as const,
      documentClass: "article",
      state: verified
        ? ("verified_tagged_fixture" as const)
        : ("not_checked" as const),
      guideTopic: "accessibility",
      templateTopic: "japanese-tagged",
      readingOrder: "not_checked" as const,
      pdfUa: "not_checked" as const,
    };
  }

  async documentRequirements(
    actor: ProjectActor,
    engine: RenderEngine,
    requirements: readonly DocumentRequirement[],
    revision?: {
      projectId: string;
      revisionId: string;
      inspectEntrypoint?: boolean | undefined;
    },
  ) {
    const saved =
      revision === undefined
        ? null
        : this.savedSources().revisionSource(
            actor,
            revision.projectId,
            revision.revisionId,
          );
    const entrypoint =
      saved && revision?.inspectEntrypoint
        ? await this.savedSources().getProjectRevisionFile(
            actor,
            saved.revision.projectId,
            saved.revision.revisionId,
            saved.entrypoint,
          )
        : null;
    const sourceCandidates = entrypoint && {
      path: entrypoint.path,
      sha256: entrypoint.sha256,
      coverage: "literal_entrypoint_declarations" as const,
      ...staticEntrypointRequirements(
        entrypoint.text,
        entrypoint.nextOffset !== null,
      ),
    };
    const capabilities = await this.environment.verifiedCapabilities();
    const inventory = await (this.requirementInventory ??=
      new DocumentRequirementInventory(
        this.environmentRoot,
        this.rendererVersion,
      )).check(requirements);
    return {
      version: 1 as const,
      runtimeDigest: capabilities.runtimeDigest,
      engine,
      engineState: capabilities.engineOutputs?.some(
        (item) => item.engine === engine && item.pdf,
      )
        ? ("verified" as const)
        : ("not_checked" as const),
      inventoryVersion: inventory.inventoryVersion,
      requirementFingerprint: requirementsFingerprint({
        engine,
        requirements,
        saved: saved?.revision ?? null,
        inspectEntrypoint: revision?.inspectEntrypoint === true,
      }),
      revision: saved?.revision ?? null,
      sourceCandidates,
      items: inventory.items,
    };
  }

  documentProbe(userId: string, input: DocumentProbe) {
    assertRenderAvailable(this.database);
    const probe = documentProbeSchema.parse(input);
    const runtimeDigest = this.environment.runtimeDigest();
    if (runtimeDigest === null)
      throw new AppError(
        "DOCUMENT_PROBE_RUNTIME_UNVERIFIED",
        "The active Runtime is not pinned",
        503,
      );
    const result = this.database.transaction(() =>
      this.database.documentProbes.request(
        userId,
        this.rendererVersion,
        probe,
        nowIso(),
      ),
    );
    return {
      probeId: result.id,
      requestFingerprint: result.fingerprint,
      runtimeDigest,
      input: probe,
      scope: "isolated_synthetic_document" as const,
      state: result.status,
      code: result.result_code,
      expiresAt: result.expires_at,
    };
  }

  private requirementInventory?: DocumentRequirementInventory;
}
