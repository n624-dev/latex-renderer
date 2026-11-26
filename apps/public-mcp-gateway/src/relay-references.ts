import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import {
  rendererRelayDownloadTargetSchema,
  type RendererRelayDownloadTarget,
} from "@latex-renderer/contracts";
import type { ConnectionAuthorization } from "./connections.js";
import { DispatchFailure } from "./renderer-dispatch.js";

const encodedReference = /^lrref_[A-Za-z0-9_-]+$/;
const idProperty =
  /^(?:(?:job|source|revision|project|upload|probe|inspection|artifact|projectRevision|baseRevision|parentRevision|adoptedRevision|expectedRevision|latestRevision|draftOriginRevision|originRevision|originalSource|previousJob|retryOf|sourceRef)(?:Ids?|Ref)?|id|(?:next)?cursor)$/i;
const resourceProperty = /resourceUri$/i;
const localId =
  /^(?:job|project|revision|source|pdfupload|probe|inspection|artifact)_[a-f0-9]{32}$/;
const resourcePrefix = "latex-renderer://relay/";

export class RelayReferences {
  readonly #key: Buffer;

  constructor(key: Uint8Array) {
    if (key.byteLength !== 32) throw new Error("Invalid gateway reference key");
    this.#key = Buffer.from(key);
  }

  seal(
    authorization: ConnectionAuthorization,
    kind: string,
    value: string,
  ): string {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.#key, nonce);
    cipher.setAAD(context(authorization, kind));
    const ciphertext = Buffer.concat([
      cipher.update(value, "utf8"),
      cipher.final(),
    ]);
    return `lrref_${Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]).toString("base64url")}`;
  }

  open(
    authorization: ConnectionAuthorization,
    kind: string,
    value: string,
  ): string {
    if (!encodedReference.test(value) || value.length > 4096)
      throw new DispatchFailure("invalid_reference");
    const bytes = Buffer.from(value.slice(6), "base64url");
    if (bytes.length < 29 || `lrref_${bytes.toString("base64url")}` !== value)
      throw new DispatchFailure("invalid_reference");
    try {
      const decipher = createDecipheriv(
        "aes-256-gcm",
        this.#key,
        bytes.subarray(0, 12),
      );
      decipher.setAAD(context(authorization, kind));
      decipher.setAuthTag(bytes.subarray(12, 28));
      return Buffer.concat([
        decipher.update(bytes.subarray(28)),
        decipher.final(),
      ]).toString("utf8");
    } catch {
      throw new DispatchFailure("invalid_reference");
    }
  }

  resource(authorization: ConnectionAuthorization, uri: string): string {
    if (uri === "latex-renderer://remote-mcp/guide") return uri;
    if (!uri.startsWith(resourcePrefix))
      throw new DispatchFailure("invalid_reference");
    return this.open(
      authorization,
      "resource",
      uri.slice(resourcePrefix.length),
    );
  }

  arguments(
    authorization: ConnectionAuthorization,
    input: Record<string, unknown>,
  ): Record<string, unknown> {
    return mapRecord(input, (key, value) => {
      if (!idProperty.test(key) || typeof value !== "string") return value;
      return this.open(authorization, referenceKind(key), value);
    });
  }

  result(
    authorization: ConnectionAuthorization,
    output: Record<string, unknown>,
    download: (
      target: RendererRelayDownloadTarget,
    ) => string | undefined = () => undefined,
  ): Record<string, unknown> {
    const transformed = mapRecord(output, (key, value) => {
      if (typeof value !== "string") return value;
      if (
        resourceProperty.test(key) &&
        value.startsWith("latex-renderer://jobs/")
      )
        return resourcePrefix + this.seal(authorization, "resource", value);
      if (key === "downloadUrl" || key === "webResultUrl") return undefined;
      if (idProperty.test(key) && (key !== "id" || localId.test(value)))
        return this.seal(authorization, referenceKind(key), value);
      return value;
    });
    const source = output.result,
      result = transformed.result;
    if (!isRecord(source) || !isRecord(result)) return transformed;
    const attach = (record: unknown, target: unknown) => {
      if (!isRecord(record)) return;
      const parsed = rendererRelayDownloadTargetSchema.safeParse(target);
      const url = parsed.success ? download(parsed.data) : undefined;
      if (url) record.downloadUrl = url;
    };
    if (isRecord(source.sourceZip))
      attach(result.sourceZip, {
        kind: "source",
        projectId: source.projectId,
        revisionId: source.revisionId,
        sha256: source.sourceZip.sha256,
      });
    if (isRecord(source.pdf) && source.pdf.availability === "available")
      attach(result.pdf, {
        kind: "artifact",
        jobId: source.pdf.jobId,
        path: "result.pdf",
        sha256: source.pdf.sha256,
      });
    if (
      isRecord(source.preview) &&
      typeof source.preview.resourceUri === "string"
    ) {
      const id =
        /^latex-renderer:\/\/jobs\/(job_[a-f0-9]{32})\/preview\/[1-9][0-9]*$/.exec(
          source.preview.resourceUri,
        )?.[1];
      if (id)
        attach(result.preview, {
          kind: "artifact",
          jobId: id,
          path: source.preview.relativePath,
          sha256: source.preview.sha256,
        });
    }
    if (
      isRecord(source.job) &&
      isRecord(result.job) &&
      Array.isArray(source.job.artifacts) &&
      Array.isArray(result.job.artifacts)
    ) {
      const artifacts: unknown[] = result.job.artifacts;
      const jobId = source.job.id;
      source.job.artifacts.forEach((item: unknown, index) => {
        if (isRecord(item))
          attach(artifacts[index], {
            kind: "artifact",
            jobId,
            path: item.relativePath,
            sha256: item.sha256,
          });
      });
    }
    return transformed;
  }
}

function context(authorization: ConnectionAuthorization, kind: string): Buffer {
  return Buffer.from(
    JSON.stringify([
      "latex-renderer-reference-v1",
      authorization.instanceId,
      authorization.profileId,
      kind,
    ]),
  );
}

function referenceKind(key: string): string {
  if (/cursor/i.test(key)) return "cursor";
  if (key === "sourceRef") return "source-ref";
  return "object";
}

function mapRecord(
  value: Record<string, unknown>,
  map: (key: string, value: unknown) => unknown,
): Record<string, unknown> {
  const visit = (key: string, item: unknown): unknown =>
    Array.isArray(item)
      ? item.map((value) => visit(key, value))
      : isRecord(item)
        ? mapRecord(item, map)
        : map(key, item);
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, item]) => [key, visit(key, item)] as const)
      .filter(([, item]) => item !== undefined),
  );
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function publicInputSchema(schema: JsonSchema): JsonSchema {
  const reference = (input: JsonSchema, field: string): JsonSchema => {
    if (idProperty.test(field) && input.type === "string")
      return {
        type: "string",
        pattern: encodedReference.source,
        ...(input.description === undefined
          ? {}
          : { description: input.description }),
      };
    if (input.type === "array" && isRecord(input.items))
      return { ...input, items: reference(input.items, field) };
    return visit(input);
  };
  function visit(value: JsonSchema): JsonSchema {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => {
        if (key === "properties" && isRecord(item))
          return [
            key,
            Object.fromEntries(
              Object.entries(item).map(([field, property]) => [
                field,
                isRecord(property) ? reference(property, field) : property,
              ]),
            ),
          ];
        if (isRecord(item)) return [key, visit(item)];
        return [
          key,
          Array.isArray(item)
            ? item.map((entry: unknown) =>
                isRecord(entry) ? visit(entry) : entry,
              )
            : item,
        ];
      }),
    );
  }
  return visit(schema);
}

type JsonSchema = Record<string, unknown>;
