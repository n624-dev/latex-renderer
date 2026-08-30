const MAX_ZIP_BYTES = 20 * 1024 * 1024;
const JOB_ID_PATTERN = /^job_[a-f0-9]{32}$/;
export const JOB_STATUSES = [
  "reserved",
  "uploading",
  "queued",
  "validating",
  "running",
  "succeeded",
  "failed",
  "timeout",
  "canceled",
  "rejected",
  "deleting",
  "deleted",
  "expired",
] as const;
const TERMINAL_JOB_STATUSES = new Set<string>([
  "succeeded",
  "failed",
  "timeout",
  "canceled",
  "rejected",
  "deleted",
  "expired",
]);

export interface ZipInspection {
  entries: number;
  files: number;
  mainTex: true;
}
export interface ZipCandidateInspection {
  entries: number;
  files: number;
  texFiles: string[];
  hasMainTex: boolean;
}

export interface BrowserSourceTicket {
  sourceId: string;
  uploadRequired: boolean;
  uploadTicket?: string;
  uploadUrl?: string;
  expiresAt: string;
}
export interface BrowserSourceRenderTicket {
  jobId: string;
  jobTicket: string;
  expiresAt: string;
}
export interface BrowserSourceRef {
  sourceRef: string;
  expiresAt: string;
}

export interface BrowserRenderTicket {
  jobId: string;
  uploadTicket: string;
  jobTicket: string;
  uploadUrl: string;
  expiresAt: string;
}

export interface AdminRenderTarget {
  apiKeyId: string;
  apiKeyName: string;
  serviceAccountId: string;
  serviceAccountName: string;
  userId: string;
  userLabel: string;
}

export interface BrowserJobArtifact {
  type: string;
  relativePath: string;
  size: number;
  sha256: string;
  createdAt: string;
  downloadUrl: string;
}

export interface BrowserJobStatus {
  id: string;
  status: (typeof JOB_STATUSES)[number];
  errorCode: string | null;
  errorMessage: string | null;
  retentionExpiresAt: string | null;
  artifacts: BrowserJobArtifact[];
  previews: BrowserJobArtifact[];
  sourceId?: string | null;
  entrypoint?: string;
}

export type RenderFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export async function runBoundedBatch<T>(
  items: readonly T[],
  limit: number,
  operation: (item: T, index: number) => Promise<void>,
): Promise<void> {
  if (!Number.isSafeInteger(limit) || limit < 1)
    throw new Error("並列数が不正です。");
  let cursor = 0;
  const worker = async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      const item = items[index];
      if (item === undefined) return;
      await operation(item, index);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
}

export function inspectZip(bytes: Uint8Array): ZipInspection {
  const inspected = inspectZipCandidates(bytes);
  if (!inspected.hasMainTex)
    throw new Error("ZIPのルートに main.tex がありません。");
  return { entries: inspected.entries, files: inspected.files, mainTex: true };
}

export function inspectZipCandidates(
  bytes: Uint8Array,
): ZipCandidateInspection {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const uint16 = (offset: number): number => {
    if (offset < 0 || offset + 2 > view.byteLength)
      throw new Error("ZIPの構造が途中で切れています。");
    return view.getUint16(offset, true);
  };
  const uint32 = (offset: number): number => {
    if (offset < 0 || offset + 4 > view.byteLength)
      throw new Error("ZIPの構造が途中で切れています。");
    return view.getUint32(offset, true);
  };
  const signature = (offset: number, expected: number): boolean =>
    offset >= 0 && offset + 4 <= view.byteLength && uint32(offset) === expected;

  if (bytes.byteLength < 22)
    throw new Error("有効なZIPファイルではありません。");
  const minimum = Math.max(0, bytes.byteLength - 65_557);
  let eocd = -1;
  for (let offset = bytes.byteLength - 22; offset >= minimum; offset -= 1) {
    if (
      signature(offset, 0x06054b50) &&
      offset + 22 + uint16(offset + 20) === bytes.byteLength
    ) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) throw new Error("ZIPの中央ディレクトリを確認できません。");

  const disk = uint16(eocd + 4);
  const directoryDisk = uint16(eocd + 6);
  const entriesOnDisk = uint16(eocd + 8);
  const entries = uint16(eocd + 10);
  const directorySize = uint32(eocd + 12);
  const directoryOffset = uint32(eocd + 16);
  if (disk !== 0 || directoryDisk !== 0 || entriesOnDisk !== entries) {
    throw new Error("分割ZIPには対応していません。");
  }
  if (
    entries === 0xffff ||
    directorySize === 0xffffffff ||
    directoryOffset === 0xffffffff
  ) {
    throw new Error("ZIP64形式には対応していません。");
  }
  const directoryEnd = directoryOffset + directorySize;
  if (directoryEnd > eocd || directoryEnd > bytes.byteLength) {
    throw new Error("ZIPの中央ディレクトリが不正です。");
  }

  const decoder = new TextDecoder("utf-8", { fatal: true });
  let cursor = directoryOffset;
  let files = 0;
  let mainTex = false;
  const texFiles: string[] = [];
  for (let index = 0; index < entries; index += 1) {
    if (!signature(cursor, 0x02014b50) || cursor + 46 > directoryEnd) {
      throw new Error("ZIPエントリを読み取れません。");
    }
    const flags = uint16(cursor + 8);
    if ((flags & 0x1) !== 0) throw new Error("暗号化ZIPは利用できません。");
    const nameLength = uint16(cursor + 28);
    const extraLength = uint16(cursor + 30);
    const commentLength = uint16(cursor + 32);
    const next = cursor + 46 + nameLength + extraLength + commentLength;
    if (next > directoryEnd)
      throw new Error("ZIPエントリ名が途中で切れています。");
    const nameBytes = bytes.subarray(cursor + 46, cursor + 46 + nameLength);
    if ((flags & 0x800) === 0 && nameBytes.some((value) => value > 0x7f)) {
      throw new Error("UTF-8ではないファイル名を含むZIPは利用できません。");
    }
    let name: string;
    try {
      name = decoder.decode(nameBytes);
    } catch {
      throw new Error("ZIPエントリ名をUTF-8として読み取れません。");
    }
    if (!name.endsWith("/")) {
      files += 1;
      if (files > 500)
        throw new Error("ZIP内のファイル数が500件を超えています。");
      if (name === "main.tex") mainTex = true;
      if (name.toLowerCase().endsWith(".tex"))
        texFiles.push(name.normalize("NFC"));
    }
    cursor = next;
  }
  if (cursor !== directoryEnd)
    throw new Error("ZIPの中央ディレクトリ長が一致しません。");
  if (texFiles.length === 0) throw new Error("ZIPにTeXファイルがありません。");
  return { entries, files, texFiles, hasMainTex: mainTex };
}

export function zipSingleTex(bytes: Uint8Array): Uint8Array {
  const name = new TextEncoder().encode("main.tex"),
    crc = crc32(bytes),
    local = new Uint8Array(30 + name.length + bytes.length),
    lv = new DataView(local.buffer);
  lv.setUint32(0, 0x04034b50, true);
  lv.setUint16(4, 20, true);
  lv.setUint16(6, 0x800, true);
  lv.setUint16(8, 0, true);
  lv.setUint32(14, crc, true);
  lv.setUint32(18, bytes.length, true);
  lv.setUint32(22, bytes.length, true);
  lv.setUint16(26, name.length, true);
  local.set(name, 30);
  local.set(bytes, 30 + name.length);
  const central = new Uint8Array(46 + name.length),
    cv = new DataView(central.buffer);
  cv.setUint32(0, 0x02014b50, true);
  cv.setUint16(4, 20, true);
  cv.setUint16(6, 20, true);
  cv.setUint16(8, 0x800, true);
  cv.setUint16(10, 0, true);
  cv.setUint32(16, crc, true);
  cv.setUint32(20, bytes.length, true);
  cv.setUint32(24, bytes.length, true);
  cv.setUint16(28, name.length, true);
  central.set(name, 46);
  const end = new Uint8Array(22),
    ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, 1, true);
  ev.setUint16(10, 1, true);
  ev.setUint32(12, central.length, true);
  ev.setUint32(16, local.length, true);
  const output = new Uint8Array(local.length + central.length + end.length);
  output.set(local);
  output.set(central, local.length);
  output.set(end, local.length + central.length);
  return output;
}

export function zipStoredFiles(
  files: { name: string; bytes: Uint8Array }[],
): Uint8Array {
  if (files.length === 0 || files.length > 100)
    throw new Error("ZIPへ格納できるファイル数を超えています。");
  const encoder = new TextEncoder(),
    chunks: Uint8Array[] = [],
    central: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name.replaceAll("\\", "/"));
    if (
      name.length === 0 ||
      name.length > 65_535 ||
      file.bytes.length > 0xffffffff
    )
      throw new Error("ZIPへ格納できないファイルがあります。");
    const checksum = crc32(file.bytes),
      local = new Uint8Array(30 + name.length),
      localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0x0800, true);
    localView.setUint32(14, checksum, true);
    localView.setUint32(18, file.bytes.length, true);
    localView.setUint32(22, file.bytes.length, true);
    localView.setUint16(26, name.length, true);
    local.set(name, 30);
    chunks.push(local, file.bytes);
    const directory = new Uint8Array(46 + name.length),
      directoryView = new DataView(directory.buffer);
    directoryView.setUint32(0, 0x02014b50, true);
    directoryView.setUint16(4, 20, true);
    directoryView.setUint16(6, 20, true);
    directoryView.setUint16(8, 0x0800, true);
    directoryView.setUint32(16, checksum, true);
    directoryView.setUint32(20, file.bytes.length, true);
    directoryView.setUint32(24, file.bytes.length, true);
    directoryView.setUint16(28, name.length, true);
    directoryView.setUint32(42, offset, true);
    directory.set(name, 46);
    central.push(directory);
    offset += local.length + file.bytes.length;
  }
  const centralSize = central.reduce((sum, chunk) => sum + chunk.length, 0),
    end = new Uint8Array(22),
    endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);
  const result = new Uint8Array(offset + centralSize + end.length);
  let cursor = 0;
  for (const chunk of [...chunks, ...central, end]) {
    result.set(chunk, cursor);
    cursor += chunk.length;
  }
  return result;
}
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1)
      crc = (crc >>> 1) ^ ((crc & 1) !== 0 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    bytes.slice().buffer,
  );
  return Array.from(new Uint8Array(digest), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
}

export function parseRenderTicket(
  value: unknown,
  expectedOrigin: string,
): BrowserRenderTicket {
  if (typeof value !== "object" || value === null)
    throw new Error("Ticket応答の形式が不正です。");
  const record = value as Record<string, unknown>;
  const jobId = record.jobId;
  const uploadTicket = record.uploadTicket;
  const jobTicket = record.jobTicket;
  const uploadUrl = record.uploadUrl;
  const expiresAt = record.expiresAt;
  if (
    typeof jobId !== "string" ||
    !JOB_ID_PATTERN.test(jobId) ||
    typeof uploadTicket !== "string" ||
    uploadTicket.length < 16 ||
    typeof jobTicket !== "string" ||
    jobTicket.length < 16 ||
    typeof uploadUrl !== "string" ||
    typeof expiresAt !== "string" ||
    !Number.isFinite(Date.parse(expiresAt))
  ) {
    throw new Error("Ticket応答の形式が不正です。");
  }
  const url = new URL(uploadUrl);
  const expected = new URL(
    `/api/v1/jobs/${encodeURIComponent(jobId)}/source`,
    expectedOrigin,
  );
  if (
    url.origin !== expected.origin ||
    url.pathname !== expected.pathname ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error("ZIP送信先が公開Renderer APIと一致しません。");
  }
  return {
    jobId,
    uploadTicket,
    jobTicket,
    uploadUrl: url.toString(),
    expiresAt,
  };
}

export function parseJobStatus(
  value: unknown,
  expectedJobId: string,
): BrowserJobStatus {
  if (typeof value !== "object" || value === null)
    throw new Error("ジョブ応答の形式が不正です。");
  const record = value as Record<string, unknown>;
  const retentionExpiresAt = record.retentionExpiresAt;
  if (
    record.id !== expectedJobId ||
    typeof record.status !== "string" ||
    !JOB_STATUSES.includes(record.status as (typeof JOB_STATUSES)[number]) ||
    !(record.errorCode === null || typeof record.errorCode === "string") ||
    !(
      record.errorMessage === null || typeof record.errorMessage === "string"
    ) ||
    !(
      retentionExpiresAt === null ||
      (typeof retentionExpiresAt === "string" &&
        Number.isFinite(Date.parse(retentionExpiresAt)))
    ) ||
    !Array.isArray(record.artifacts) ||
    !Array.isArray(record.previews)
  ) {
    throw new Error("ジョブ応答の形式が不正です。");
  }
  const artifacts = record.artifacts.map((artifact) =>
    parseJobArtifact(artifact, expectedJobId, false),
  );
  const previews = record.previews.map((artifact) =>
    parseJobArtifact(artifact, expectedJobId, true),
  );
  return {
    id: expectedJobId,
    status: record.status as BrowserJobStatus["status"],
    errorCode: record.errorCode,
    errorMessage: record.errorMessage,
    retentionExpiresAt,
    artifacts,
    previews,
  };
}

export function parseJobArtifact(
  value: unknown,
  jobId: string,
  preview: boolean,
): BrowserJobArtifact {
  if (typeof value !== "object" || value === null)
    throw new Error("成果物情報の形式が不正です。");
  const record = value as Record<string, unknown>;
  const relativePath = record.relativePath;
  const type = record.type;
  const downloadUrl = record.downloadUrl;
  if (
    typeof type !== "string" ||
    type.length === 0 ||
    typeof relativePath !== "string" ||
    relativePath.length === 0 ||
    typeof record.size !== "number" ||
    !Number.isInteger(record.size) ||
    record.size < 0 ||
    typeof record.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(record.sha256) ||
    typeof record.createdAt !== "string" ||
    !Number.isFinite(Date.parse(record.createdAt)) ||
    typeof downloadUrl !== "string"
  ) {
    throw new Error("成果物情報の形式が不正です。");
  }
  let expectedUrl: string;
  if (preview) {
    if (
      type !== "preview" ||
      !/^previews\/page-[0-9]{1,3}\.png$/.test(relativePath)
    )
      throw new Error("プレビュー情報の形式が不正です。");
    expectedUrl = `/api/v1/jobs/${encodeURIComponent(jobId)}/previews/${encodeURIComponent(relativePath.slice("previews/".length))}`;
  } else {
    const flat =
        ["pdf", "log", "errors", "dependencies"].includes(type) &&
        /^(?:result\.pdf|compile\.log|errors\.json|dependencies\.json)$/.test(
          relativePath,
        ),
      svgManifest =
        type === "svg_manifest" && relativePath === "svg/manifest.json",
      svgObject =
        type === "svg" &&
        /^svg\/objects\/(?:math|tikz)-[0-9]{6}\.svg$/.test(relativePath);
    if (!flat && !svgManifest && !svgObject)
      throw new Error("成果物情報の形式が不正です。");
    expectedUrl = `/api/v1/jobs/${encodeURIComponent(jobId)}/artifacts/${relativePath.split("/").map(encodeURIComponent).join("/")}`;
  }
  if (downloadUrl !== expectedUrl)
    throw new Error("成果物URLが対象ジョブと一致しません。");
  return {
    type,
    relativePath,
    size: record.size,
    sha256: record.sha256,
    createdAt: record.createdAt,
    downloadUrl,
  };
}

export async function responseError(response: Response): Promise<Error> {
  let code = "HTTP_ERROR";
  let message = `サーバーがHTTP ${response.status}を返しました。`;
  try {
    const value = (await response.json()) as unknown;
    if (typeof value === "object" && value !== null && "error" in value) {
      const error = (value as { error?: unknown }).error;
      if (typeof error === "object" && error !== null) {
        const record = error as Record<string, unknown>;
        if (typeof record.code === "string") code = record.code;
        if (typeof record.message === "string") message = record.message;
      }
    }
  } catch {
    // Keep the status-only message for non-JSON responses.
  }
  const error = new Error(`${code}: ${message}`) as Error & {
    code?: string;
    status?: number;
  };
  error.code = code;
  error.status = response.status;
  return error;
}

async function responseJson(response: Response): Promise<unknown> {
  if (!response.ok) throw await responseError(response);
  try {
    return (await response.json()) as unknown;
  } catch {
    throw new Error("サーバー応答をJSONとして読み取れません。");
  }
}

function parseAdminRenderTargets(value: unknown): AdminRenderTarget[] {
  if (
    typeof value !== "object" ||
    value === null ||
    !("items" in value) ||
    !Array.isArray((value as { items?: unknown }).items)
  )
    throw new Error("レンダリング候補の応答形式が不正です。");
  return (value as { items: unknown[] }).items.map((item) => {
    if (typeof item !== "object" || item === null)
      throw new Error("レンダリング候補の応答形式が不正です。");
    const row = item as Record<string, unknown>;
    for (const key of [
      "apiKeyId",
      "apiKeyName",
      "serviceAccountId",
      "serviceAccountName",
      "userId",
      "userLabel",
    ] as const)
      if (typeof row[key] !== "string" || row[key].length === 0)
        throw new Error("レンダリング候補の応答形式が不正です。");
    return row as unknown as AdminRenderTarget;
  });
}

export async function fetchAdminRenderTargets(
  fetcher: RenderFetch,
  origin: string,
): Promise<AdminRenderTarget[]> {
  const response = await fetcher(
    new URL("/admin/api/v1/jobs/render-targets", origin),
    {
      cache: "no-store",
      credentials: "same-origin",
      redirect: "error",
      headers: { "Cache-Control": "no-store", Pragma: "no-cache" },
    },
  );
  return parseAdminRenderTargets(await responseJson(response));
}

export async function createAdminRenderTicket(
  fetcher: RenderFetch,
  origin: string,
  apiKeyId: string,
  size: number,
  sha256: string,
  idempotencyKey: string,
  csrfToken: string,
  outputs: ("pdf" | "svg")[] = ["pdf"],
): Promise<BrowserRenderTicket> {
  const response = await fetcher(
    new URL("/admin/api/v1/jobs/render-tickets", origin),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": csrfToken,
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify({ apiKeyId, size, sha256, outputs }),
      cache: "no-store",
      credentials: "same-origin",
      redirect: "error",
      referrerPolicy: "no-referrer",
    },
  );
  return parseRenderTicket(await responseJson(response), origin);
}

export function parseSourceTicket(
  value: unknown,
  expectedOrigin: string,
): BrowserSourceTicket {
  if (typeof value !== "object" || value === null)
    throw new Error("Source応答の形式が不正です。");
  const row = value as Record<string, unknown>;
  if (
    typeof row.sourceId !== "string" ||
    !/^source_[a-f0-9]{32}$/.test(row.sourceId) ||
    typeof row.uploadRequired !== "boolean" ||
    typeof row.expiresAt !== "string" ||
    !Number.isFinite(Date.parse(row.expiresAt))
  )
    throw new Error("Source応答の形式が不正です。");
  if (!row.uploadRequired)
    return {
      sourceId: row.sourceId,
      uploadRequired: false,
      expiresAt: row.expiresAt,
    };
  if (
    typeof row.uploadTicket !== "string" ||
    row.uploadTicket.length < 16 ||
    typeof row.uploadUrl !== "string"
  )
    throw new Error("Source応答の形式が不正です。");
  const url = new URL(row.uploadUrl),
    expected = new URL(
      `/api/v1/sources/${encodeURIComponent(row.sourceId)}/content`,
      expectedOrigin,
    );
  if (
    url.origin !== expected.origin ||
    url.pathname !== expected.pathname ||
    url.search !== "" ||
    url.hash !== "" ||
    url.username !== "" ||
    url.password !== ""
  )
    throw new Error("ZIP送信先が公開Renderer APIと一致しません。");
  return {
    sourceId: row.sourceId,
    uploadRequired: true,
    uploadTicket: row.uploadTicket,
    uploadUrl: url.toString(),
    expiresAt: row.expiresAt,
  };
}

export async function createAdminSourceTicket(
  fetcher: RenderFetch,
  origin: string,
  apiKeyId: string,
  size: number,
  sha256: string,
  idempotencyKey: string,
  csrfToken: string,
): Promise<BrowserSourceTicket> {
  const response = await fetcher(
    new URL("/admin/api/v1/jobs/source-tickets", origin),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": csrfToken,
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify({ apiKeyId, size, sha256 }),
      cache: "no-store",
      credentials: "same-origin",
      redirect: "error",
      referrerPolicy: "no-referrer",
    },
  );
  return parseSourceTicket(await responseJson(response), origin);
}

export async function createAdminSourceRef(
  fetcher: RenderFetch,
  origin: string,
  apiKeyId: string,
  sourceId: string,
  csrfToken: string,
): Promise<BrowserSourceRef> {
  const response = await fetcher(
      new URL("/admin/api/v1/jobs/source-refs", origin),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken,
        },
        body: JSON.stringify({ apiKeyId, sourceId }),
        cache: "no-store",
        credentials: "same-origin",
        redirect: "error",
        referrerPolicy: "no-referrer",
      },
    ),
    value = await responseJson(response);
  if (typeof value !== "object" || value === null)
    throw new Error("Source参照の応答形式が不正です。");
  const row = value as Record<string, unknown>;
  if (
    typeof row.sourceRef !== "string" ||
    !/^source_ref_[a-f0-9]{32}$/.test(row.sourceRef) ||
    typeof row.expiresAt !== "string" ||
    !Number.isFinite(Date.parse(row.expiresAt))
  )
    throw new Error("Source参照の応答形式が不正です。");
  return { sourceRef: row.sourceRef, expiresAt: row.expiresAt };
}

export async function uploadSourceZip(
  fetcher: RenderFetch,
  ticket: BrowserSourceTicket,
  body: Blob,
): Promise<void> {
  if (!ticket.uploadRequired) return;
  if (ticket.uploadUrl === undefined || ticket.uploadTicket === undefined)
    throw new Error("Sourceアップロード情報がありません。");
  const response = await fetcher(ticket.uploadUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${ticket.uploadTicket}`,
      "Content-Type": "application/zip",
    },
    body,
    cache: "no-store",
    credentials: "omit",
    redirect: "error",
    referrerPolicy: "no-referrer",
  });
  if (!response.ok) throw await responseError(response);
}

export async function createAdminSourceRenderTicket(
  fetcher: RenderFetch,
  origin: string,
  apiKeyId: string,
  sourceId: string,
  entrypoint: string,
  idempotencyKey: string,
  csrfToken: string,
  outputs: ("pdf" | "svg")[] = ["pdf"],
): Promise<BrowserSourceRenderTicket> {
  const response = await fetcher(
      new URL("/admin/api/v1/jobs/render-tickets", origin),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken,
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({ apiKeyId, sourceId, entrypoint, outputs }),
        cache: "no-store",
        credentials: "same-origin",
        redirect: "error",
        referrerPolicy: "no-referrer",
      },
    ),
    value = await responseJson(response);
  if (typeof value !== "object" || value === null)
    throw new Error("Job応答の形式が不正です。");
  const row = value as Record<string, unknown>;
  if (
    typeof row.jobId !== "string" ||
    !JOB_ID_PATTERN.test(row.jobId) ||
    typeof row.jobTicket !== "string" ||
    row.jobTicket.length < 16 ||
    typeof row.expiresAt !== "string" ||
    !Number.isFinite(Date.parse(row.expiresAt))
  )
    throw new Error("Job応答の形式が不正です。");
  return {
    jobId: row.jobId,
    jobTicket: row.jobTicket,
    expiresAt: row.expiresAt,
  };
}

export async function uploadRenderZip(
  fetcher: RenderFetch,
  ticket: BrowserRenderTicket,
  file: File,
): Promise<void> {
  const response = await fetcher(ticket.uploadUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${ticket.uploadTicket}`,
      "Content-Type": "application/zip",
    },
    body: file,
    cache: "no-store",
    credentials: "omit",
    redirect: "error",
    referrerPolicy: "no-referrer",
  });
  if (!response.ok) throw await responseError(response);
}

export async function fetchRenderJob(
  fetcher: RenderFetch,
  origin: string,
  jobId: string,
  jobTicket: string,
): Promise<BrowserJobStatus> {
  const url = new URL(`/api/v1/jobs/${encodeURIComponent(jobId)}`, origin);
  url.searchParams.set(
    "fresh",
    `${Date.now()}-${globalThis.crypto.randomUUID()}`,
  );
  const response = await fetcher(url, {
    headers: {
      Authorization: `Bearer ${jobTicket}`,
      "Cache-Control": "no-store",
      Pragma: "no-cache",
    },
    cache: "no-store",
    credentials: "omit",
    redirect: "error",
    referrerPolicy: "no-referrer",
  });
  return parseJobStatus(await responseJson(response), jobId);
}

export async function cancelRenderJob(
  fetcher: RenderFetch,
  origin: string,
  jobId: string,
  jobTicket: string,
): Promise<void> {
  const response = await fetcher(
    new URL(`/api/v1/jobs/${encodeURIComponent(jobId)}/cancel`, origin),
    {
      method: "POST",
      headers: { Authorization: `Bearer ${jobTicket}` },
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
    },
  );
  if (!response.ok) throw await responseError(response);
}

export async function fetchRenderArtifact(
  fetcher: RenderFetch,
  origin: string,
  jobTicket: string,
  artifact: BrowserJobArtifact,
): Promise<Blob> {
  const url = new URL(artifact.downloadUrl, origin);
  if (url.origin !== new URL(origin).origin)
    throw new Error("成果物の取得先が公開Renderer APIと一致しません。");
  url.searchParams.set(
    "fresh",
    `${Date.now()}-${globalThis.crypto.randomUUID()}`,
  );
  const response = await fetcher(url, {
    headers: {
      Authorization: `Bearer ${jobTicket}`,
      "Cache-Control": "no-store",
      Pragma: "no-cache",
    },
    cache: "no-store",
    credentials: "omit",
    redirect: "error",
    referrerPolicy: "no-referrer",
  });
  if (!response.ok) throw await responseError(response);
  const blob = await response.blob();
  if (blob.size !== artifact.size)
    throw new Error("成果物のサイズがサーバー情報と一致しません。");
  const digest = await sha256Hex(new Uint8Array(await blob.arrayBuffer()));
  if (digest !== artifact.sha256)
    throw new Error("成果物のSHA-256がサーバー情報と一致しません。");
  return blob;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

function jobStatusLabel(status: string): string {
  return (
    (
      {
        reserved: "予約済み",
        uploading: "アップロード中",
        queued: "待機中",
        validating: "検証中",
        running: "変換中",
        succeeded: "変換成功",
        failed: "変換失敗",
        timeout: "タイムアウト",
        canceled: "キャンセル済み",
        rejected: "受付拒否",
        deleting: "削除中",
        deleted: "削除済み",
        expired: "保存期限切れ",
        waiting: "ブラウザ内で待機中",
        preparing: "Source準備中",
        "failed-local": "失敗",
        "canceled-local": "キャンセル済み",
      } as Record<string, string>
    )[status] ?? status
  );
}

function installRenderWorkflow(csrfToken: string): void {
  const form = document.querySelector<HTMLFormElement>("#render-preflight"),
    input = document.querySelector<HTMLInputElement>("#project-files"),
    directory = document.querySelector<HTMLInputElement>("#project-directory"),
    inspect = document.querySelector<HTMLButtonElement>("#inspect-files"),
    error = document.querySelector<HTMLElement>("#render-error"),
    status = document.querySelector<HTMLElement>("#render-status"),
    summary = document.querySelector<HTMLElement>("#render-summary"),
    selection = document.querySelector<HTMLElement>("#render-selection"),
    startForm = document.querySelector<HTMLFormElement>("#render-start"),
    svgOutput = document.querySelector<HTMLInputElement>("#render-svg"),
    target = document.querySelector<HTMLSelectElement>("#render-target"),
    start = document.querySelector<HTMLButtonElement>("#start-render"),
    createRef = document.querySelector<HTMLButtonElement>("#create-source-ref"),
    sourceRefOutput =
      document.querySelector<HTMLOutputElement>("#source-ref-output"),
    batchSection = document.querySelector<HTMLElement>("#render-batch"),
    rows = document.querySelector<HTMLElement>("#render-items"),
    batchSummary = document.querySelector<HTMLElement>("#render-batch-summary"),
    downloadSuccessful = document.querySelector<HTMLButtonElement>(
      "#download-successful-render",
    ),
    retryFailed = document.querySelector<HTMLButtonElement>(
      "#retry-failed-render",
    ),
    cancelAll = document.querySelector<HTMLButtonElement>("#cancel-all-render");
  if (
    !form ||
    !input ||
    !directory ||
    !inspect ||
    !error ||
    !status ||
    !summary ||
    !selection ||
    !startForm ||
    !svgOutput ||
    !target ||
    !start ||
    !createRef ||
    !sourceRefOutput ||
    !batchSection ||
    !rows ||
    !batchSummary ||
    !downloadSuccessful ||
    !retryFailed ||
    !cancelAll
  )
    return;
  type Prepared = {
    label: string;
    entrypoint: string;
    blob: Blob;
    size: number;
    sha256: string;
    legacy: boolean;
    selected: boolean;
  };
  type Task = Prepared & {
    id: string;
    state: string;
    jobId?: string;
    jobTicket?: string;
    job?: BrowserJobStatus;
    message?: string;
    canceled: boolean;
    sourceKey: string;
    sourceId?: string;
  };
  let prepared: Prepared[] = [],
    tasks: Task[] = [],
    sharedBlob: Blob | undefined,
    sharedSize = 0,
    generation = 0,
    targetsReady = false,
    running = false;
  const fetcher = globalThis.fetch.bind(globalThis),
    origin = globalThis.location.origin,
    sleep = (ms: number) =>
      new Promise((resolve) => globalThis.setTimeout(resolve, ms));
  const updateStart = () => {
    const chosen = prepared.filter((item) => item.selected);
    start.disabled =
      running || !targetsReady || target.value === "" || chosen.length === 0;
    createRef.disabled =
      running ||
      !targetsReady ||
      target.value === "" ||
      chosen.length === 0 ||
      (sharedBlob === undefined && chosen.length !== 1);
  };
  const clearTickets = () => {
    for (const task of tasks)
      if (task.jobTicket !== undefined) task.jobTicket = "";
  };
  const reset = () => {
    generation += 1;
    prepared = [];
    tasks = [];
    sharedBlob = undefined;
    sharedSize = 0;
    running = false;
    clearTickets();
    summary.hidden = true;
    batchSection.hidden = true;
    selection.replaceChildren();
    rows.replaceChildren();
    error.textContent = "";
    status.textContent = "";
    sourceRefOutput.textContent = "";
    batchSummary.replaceChildren();
    downloadSuccessful.disabled = true;
    retryFailed.disabled = true;
    inspect.disabled =
      (input.files?.length ?? 0) + (directory.files?.length ?? 0) === 0;
    input.disabled = false;
    directory.disabled = false;
    target.disabled = !targetsReady;
    updateStart();
  };
  const addChoice = (item: Prepared) => {
    const label = document.createElement("label"),
      box = document.createElement("input"),
      text = document.createElement("span");
    box.type = "checkbox";
    box.checked = item.selected;
    box.addEventListener("change", () => {
      item.selected = box.checked;
      updateStart();
    });
    text.textContent = `${item.label}（${formatBytes(item.size)}）`;
    label.append(box, text);
    selection.append(label);
  };
  const inspectSelected = async () => {
    const files = [...(input.files ?? []), ...(directory.files ?? [])],
      current = ++generation;
    prepared = [];
    sharedBlob = undefined;
    selection.replaceChildren();
    summary.hidden = true;
    error.textContent = "";
    status.textContent = "ファイルを確認しています…";
    inspect.disabled = true;
    try {
      if (files.length === 0) throw new Error("ファイルを選択してください。");
      if (files.length > 200)
        throw new Error("一度に選択できるファイルは200件までです。");
      const zips = files.filter((file) =>
          file.name.toLowerCase().endsWith(".zip"),
        ),
        tex = files.filter((file) => file.name.toLowerCase().endsWith(".tex"));
      if (zips.length > 0 && files.length > 1)
        throw new Error("ZIPと他のファイルは同時に選択できません。");
      if (zips.length > 1) throw new Error("ZIPは1件だけ選択してください。");
      if (zips.length === 1) {
        const file = zips[0] as File;
        if (file.size <= 0 || file.size > MAX_ZIP_BYTES)
          throw new Error("ZIPは20 MiB以下にしてください。");
        const bytes = new Uint8Array(await file.arrayBuffer()),
          found = inspectZipCandidates(bytes),
          sha = await sha256Hex(bytes);
        sharedBlob = new Blob([bytes.slice().buffer], {
          type: "application/zip",
        });
        sharedSize = bytes.length;
        if (found.hasMainTex)
          prepared = [
            {
              label: file.name,
              entrypoint: "main.tex",
              blob: sharedBlob,
              size: sharedSize,
              sha256: sha,
              legacy: true,
              selected: true,
            },
          ];
        else
          prepared = found.texFiles.slice(0, 20).map((entrypoint) => ({
            label: entrypoint,
            entrypoint,
            blob: sharedBlob as Blob,
            size: sharedSize,
            sha256: sha,
            legacy: false,
            selected: true,
          }));
        if (found.texFiles.length > 20)
          throw new Error("ZIP内のTeX候補は20件までです。");
      } else if (
        tex.length === files.length &&
        files.every((file) => !file.webkitRelativePath)
      ) {
        for (const file of tex) {
          if (file.size <= 0) throw new Error(`${file.name} は空です。`);
          const archive = zipSingleTex(
            new Uint8Array(await file.arrayBuffer()),
          );
          if (archive.length > MAX_ZIP_BYTES)
            throw new Error(`${file.name} は送信上限を超えています。`);
          const blob = new Blob([archive.slice().buffer], {
            type: "application/zip",
          });
          prepared.push({
            label: file.name,
            entrypoint: "main.tex",
            blob,
            size: archive.length,
            sha256: await sha256Hex(archive),
            legacy: false,
            selected: true,
          });
        }
      } else {
        const firstSegments = files.map(
            (file) => file.webkitRelativePath.split("/")[0],
          ),
          stripRoot =
            firstSegments[0] !== "" &&
            firstSegments.every((segment) => segment === firstSegments[0]),
          archived: { name: string; bytes: Uint8Array }[] = [];
        for (const file of files) {
          const original = file.webkitRelativePath || file.name,
            name = stripRoot
              ? original.split("/").slice(1).join("/")
              : original;
          if (
            !name ||
            name.startsWith("/") ||
            name.includes("\\") ||
            name
              .split("/")
              .some(
                (segment) => !segment || segment === "." || segment === "..",
              )
          )
            throw new Error(`${file.name} のパスは利用できません。`);
          archived.push({
            name,
            bytes: new Uint8Array(await file.arrayBuffer()),
          });
        }
        const archive = zipStoredFiles(archived);
        if (archive.length > MAX_ZIP_BYTES)
          throw new Error("プロジェクトはZIP化後20 MiB以下にしてください。");
        const entrypoints = archived
          .map((file) => file.name)
          .filter((name) => name.toLowerCase().endsWith(".tex"));
        if (entrypoints.length === 0)
          throw new Error("プロジェクトにTeXファイルがありません。");
        if (entrypoints.length > 20)
          throw new Error("TeXのentrypoint候補は20件までです。");
        sharedBlob = new Blob([archive.slice().buffer], {
          type: "application/zip",
        });
        sharedSize = archive.length;
        const sha = await sha256Hex(archive),
          fileList = document.createElement("details"),
          fileSummary = document.createElement("summary"),
          list = document.createElement("ul");
        fileSummary.textContent = `送信ファイル ${archived.length}件`;
        list.className = "source-tree";
        for (const file of archived) {
          const item = document.createElement("li"),
            code = document.createElement("code");
          code.textContent = file.name;
          item.append(code);
          list.append(item);
        }
        fileList.append(fileSummary, list);
        selection.append(fileList);
        prepared = entrypoints.map((entrypoint) => ({
          label: entrypoint,
          entrypoint,
          blob: sharedBlob as Blob,
          size: sharedSize,
          sha256: sha,
          legacy: false,
          selected: entrypoint === "main.tex" || entrypoints.length === 1,
        }));
      }
      if (current !== generation) return;
      prepared.forEach(addChoice);
      summary.hidden = false;
      status.textContent = `${prepared.length}件の候補を確認しました。`;
      document.dispatchEvent(
        new CustomEvent("latex-renderer:preflight-ready", {
          detail: { count: prepared.length },
        }),
      );
    } catch (caught) {
      if (current === generation)
        error.textContent =
          caught instanceof Error ? caught.message : String(caught);
    } finally {
      if (current === generation) {
        inspect.disabled = false;
        updateStart();
      }
    }
  };
  const retryable = (caught: unknown) => {
    const value = caught as { code?: unknown; status?: unknown };
    return (
      value.code === "QUEUE_FULL" ||
      value.code === "ACCOUNT_QUEUE_LIMIT" ||
      (typeof value.status === "number" && value.status >= 500)
    );
  };
  const bounded = async <T>(operation: () => Promise<T>): Promise<T> => {
    let last: unknown;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        return await operation();
      } catch (caught) {
        last = caught;
        if (!retryable(caught) || attempt === 3) throw caught;
        await sleep(300 * 2 ** attempt);
      }
    }
    throw last;
  };
  const renderRows = () => {
    rows.replaceChildren();
    for (const task of tasks) {
      const row = document.createElement("tr"),
        name = document.createElement("td"),
        state = document.createElement("td"),
        job = document.createElement("td"),
        actions = document.createElement("td");
      name.textContent = task.label;
      state.textContent = task.message ?? jobStatusLabel(task.state);
      job.textContent = task.jobId ?? "—";
      if (
        !TERMINAL_JOB_STATUSES.has(task.state) &&
        task.state !== "failed-local" &&
        task.state !== "canceled-local"
      ) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "secondary";
        button.textContent = "中止";
        button.addEventListener("click", () => void cancelTask(task));
        actions.append(button);
      }
      if (task.job && task.jobTicket) {
        for (const [path, label] of [
          ["result.pdf", "PDF"],
          ["compile.log", "ログ"],
          ["errors.json", "エラー"],
        ] as const) {
          const artifact = task.job.artifacts.find(
            (item) => item.relativePath === path,
          );
          if (artifact) {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "secondary";
            button.textContent = label;
            button.addEventListener(
              "click",
              () => void download(task, artifact, path),
            );
            actions.append(button);
          }
        }
        const svgArtifacts = task.job.artifacts.filter(
          (artifact) =>
            artifact.type === "svg" || artifact.type === "svg_manifest",
        );
        if (svgArtifacts.length > 0) {
          const details = document.createElement("details"),
            summary = document.createElement("summary"),
            list = document.createElement("div");
          summary.textContent = `SVG (${svgArtifacts.length})`;
          list.className = "actions";
          for (const artifact of svgArtifacts) {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "secondary";
            button.textContent =
              artifact.type === "svg_manifest"
                ? "manifest.json"
                : (artifact.relativePath.split("/").at(-1) ?? "SVG");
            button.addEventListener(
              "click",
              () => void download(task, artifact, artifact.relativePath),
            );
            list.append(button);
          }
          details.append(summary, list);
          actions.append(details);
        }
        const preview = task.job.previews[0];
        if (preview) {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "secondary";
          button.textContent = "プレビュー";
          button.addEventListener(
            "click",
            () => void download(task, preview, "page-1.png"),
          );
          actions.append(button);
        }
      }
      if (task.jobId) {
        const detail = document.createElement("a");
        detail.className = "button secondary";
        detail.href = `/admin/jobs/?job=${encodeURIComponent(task.jobId)}`;
        detail.textContent = "結果詳細";
        actions.append(detail);
      }
      row.append(name, state, job, actions);
      rows.append(row);
    }
    const succeeded = tasks.filter((task) => task.state === "succeeded").length,
      completed = tasks.filter(
        (task) =>
          TERMINAL_JOB_STATUSES.has(task.state) ||
          task.state === "failed-local" ||
          task.state === "canceled-local",
      ).length,
      failed = completed - succeeded,
      active = tasks.length - completed;
    batchSummary.replaceChildren();
    for (const [label, value] of [
      ["成功", succeeded],
      ["失敗・中止", failed],
      ["実行中・待機", active],
    ] as const) {
      const item = document.createElement("div"),
        title = document.createElement("strong"),
        count = document.createElement("p");
      title.textContent = label;
      count.textContent = `${value}件`;
      item.append(title, count);
      batchSummary.append(item);
    }
    downloadSuccessful.disabled = !tasks.some(
      (task) =>
        task.state === "succeeded" &&
        task.jobTicket &&
        task.job?.artifacts.some((item) => item.relativePath === "result.pdf"),
    );
    retryFailed.disabled = !tasks.some(
      (task) =>
        task.jobId &&
        ["failed", "timeout", "canceled", "rejected"].includes(task.state),
    );
    if (running) {
      status.textContent = `${tasks.length}件中 ${completed}件完了（最大3件ずつ処理）`;
    }
  };
  const cancelTask = async (task: Task) => {
    task.canceled = true;
    if (task.jobId && task.jobTicket) {
      task.message = "中止を要求中";
      renderRows();
      try {
        await cancelRenderJob(fetcher, origin, task.jobId, task.jobTicket);
      } catch (caught) {
        task.message =
          caught instanceof Error ? caught.message : String(caught);
      }
    } else {
      task.state = "canceled-local";
      task.message = "開始前に中止";
    }
    renderRows();
  };
  const download = async (
    task: Task,
    artifact: BrowserJobArtifact,
    name: string,
  ) => {
    if (!task.jobTicket) return;
    try {
      const blob = await fetchRenderArtifact(
          fetcher,
          origin,
          task.jobTicket,
          artifact,
        ),
        url = URL.createObjectURL(blob),
        anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${task.label}-${name.split("/").at(-1) ?? "artifact"}`;
      anchor.rel = "noopener";
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      globalThis.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (caught) {
      error.textContent =
        caught instanceof Error ? caught.message : String(caught);
    }
  };
  const reserveSource = async (task: Task, apiKeyId: string) => {
    const key = `source-${task.sourceKey}`,
      ticket = await bounded(() =>
        createAdminSourceTicket(
          fetcher,
          origin,
          apiKeyId,
          task.size,
          task.sha256,
          key,
          csrfToken,
        ),
      );
    task.sourceId = ticket.sourceId;
    if (ticket.uploadRequired) {
      task.state = "uploading";
      renderRows();
      await bounded(() => uploadSourceZip(fetcher, ticket, task.blob));
      if (ticket.uploadTicket) ticket.uploadTicket = "";
    }
    return ticket.sourceId;
  };
  const poll = async (task: Task, current: number) => {
    let failures = 0;
    while (current === generation && task.jobId && task.jobTicket) {
      try {
        const job = await fetchRenderJob(
          fetcher,
          origin,
          task.jobId,
          task.jobTicket,
        );
        failures = 0;
        task.state = job.status;
        task.job = job;
        renderRows();
        if (TERMINAL_JOB_STATUSES.has(job.status)) return;
      } catch (caught) {
        failures += 1;
        if (failures >= 3) throw caught;
      }
      await sleep(1500);
    }
  };
  const runTask = async (
    task: Task,
    apiKeyId: string,
    current: number,
    outputs: ("pdf" | "svg")[],
  ) => {
    if (task.canceled) return;
    try {
      task.state = "preparing";
      renderRows();
      if (task.legacy) {
        const ticket = await bounded(() =>
          createAdminRenderTicket(
            fetcher,
            origin,
            apiKeyId,
            task.size,
            task.sha256,
            `legacy-${task.id}`,
            csrfToken,
            outputs,
          ),
        );
        task.jobId = ticket.jobId;
        task.jobTicket = ticket.jobTicket;
        task.state = "uploading";
        renderRows();
        await bounded(() =>
          uploadRenderZip(fetcher, ticket, task.blob as File),
        );
        ticket.uploadTicket = "";
      } else {
        const sourceId = task.sourceId ?? (await reserveSource(task, apiKeyId));
        const currentTask = tasks.find((item) => item.id === task.id);
        if (currentTask?.canceled === true) return;
        const ticket = await bounded(() =>
          createAdminSourceRenderTicket(
            fetcher,
            origin,
            apiKeyId,
            sourceId,
            task.entrypoint,
            `job-${task.id}`,
            csrfToken,
            outputs,
          ),
        );
        task.jobId = ticket.jobId;
        task.jobTicket = ticket.jobTicket;
        task.state = "queued";
      }
      renderRows();
      await poll(task, current);
    } catch (caught) {
      task.state = "failed-local";
      task.message = caught instanceof Error ? caught.message : String(caught);
      renderRows();
    }
  };
  const runBatch = async (
    apiKeyId: string,
    current: number,
    outputs: ("pdf" | "svg")[],
  ) => {
    const selected = tasks;
    if (sharedBlob && selected.length > 1 && !selected[0]?.legacy) {
      const shared = selected[0] as Task;
      try {
        const sourceId = await reserveSource(shared, apiKeyId);
        for (const item of selected) item.sourceId = sourceId;
      } catch (caught) {
        for (const item of selected) {
          item.state = "failed-local";
          item.message =
            caught instanceof Error ? caught.message : String(caught);
        }
        renderRows();
        return;
      }
    }
    await runBoundedBatch(selected, 3, async (task) => {
      if (!task.canceled) await runTask(task, apiKeyId, current, outputs);
    });
    status.textContent = "すべての処理が終了しました。";
    running = false;
    input.disabled = false;
    target.disabled = false;
    updateStart();
  };
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void inspectSelected();
  });
  input.addEventListener("change", () => {
    if ((input.files?.length ?? 0) > 0) directory.value = "";
    reset();
  });
  directory.addEventListener("change", () => {
    if ((directory.files?.length ?? 0) > 0) input.value = "";
    reset();
  });
  target.addEventListener("change", updateStart);
  createRef.addEventListener("click", () => {
    if (createRef.disabled || target.value === "") return;
    const chosen = prepared.filter((item) => item.selected),
      source = chosen[0];
    if (source === undefined) return;
    createRef.disabled = true;
    sourceRefOutput.textContent = "Sourceを準備しています…";
    error.textContent = "";
    void (async () => {
      try {
        const ticket = await createAdminSourceTicket(
          fetcher,
          origin,
          target.value,
          source.size,
          source.sha256,
          `remote-mcp-source-${globalThis.crypto.randomUUID()}`,
          csrfToken,
        );
        if (ticket.uploadRequired)
          await uploadSourceZip(fetcher, ticket, source.blob);
        const reference = await createAdminSourceRef(
          fetcher,
          origin,
          target.value,
          ticket.sourceId,
          csrfToken,
        );
        sourceRefOutput.textContent = `${reference.sourceRef}（有効期限: ${new Date(reference.expiresAt).toLocaleString()}）`;
      } catch (caught) {
        sourceRefOutput.textContent = "";
        error.textContent =
          caught instanceof Error ? caught.message : String(caught);
      } finally {
        updateStart();
      }
    })();
  });
  startForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (running || target.value === "") return;
    const chosen = prepared.filter((item) => item.selected);
    if (chosen.length === 0) return;
    const current = ++generation;
    tasks = chosen.map((item, index) => ({
      ...item,
      id: `${current}-${index}-${globalThis.crypto.randomUUID()}`,
      state: "waiting",
      canceled: false,
      sourceKey: `${current}-${index}-${globalThis.crypto.randomUUID()}`,
    }));
    running = true;
    input.disabled = true;
    directory.disabled = true;
    target.disabled = true;
    summary.hidden = true;
    batchSection.hidden = false;
    error.textContent = "";
    status.textContent = `${tasks.length}件を最大3件ずつ処理します。`;
    renderRows();
    updateStart();
    const outputs: ("pdf" | "svg")[] = svgOutput.checked
      ? ["pdf", "svg"]
      : ["pdf"];
    void runBatch(target.value, current, outputs);
  });
  cancelAll.addEventListener("click", () => {
    for (const task of tasks)
      if (
        !TERMINAL_JOB_STATUSES.has(task.state) &&
        task.state !== "failed-local" &&
        task.state !== "canceled-local"
      )
        void cancelTask(task);
  });
  downloadSuccessful.addEventListener("click", () => {
    downloadSuccessful.disabled = true;
    error.textContent = "";
    void (async () => {
      try {
        const files: { name: string; bytes: Uint8Array }[] = [];
        for (const [index, task] of tasks.entries()) {
          const artifact = task.job?.artifacts.find(
            (item) => item.relativePath === "result.pdf",
          );
          if (task.state !== "succeeded" || !task.jobTicket || !artifact)
            continue;
          const blob = await fetchRenderArtifact(
            fetcher,
            origin,
            task.jobTicket,
            artifact,
          );
          files.push({
            name: `${String(index + 1).padStart(2, "0")}-${task.label.replace(/[^A-Za-z0-9._-]+/g, "_")}.pdf`,
            bytes: new Uint8Array(await blob.arrayBuffer()),
          });
        }
        const archive = zipStoredFiles(files),
          url = URL.createObjectURL(
            new Blob([archive.slice().buffer], { type: "application/zip" }),
          ),
          anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = "latex-renderer-pdfs.zip";
        document.body.append(anchor);
        anchor.click();
        anchor.remove();
        globalThis.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      } catch (caught) {
        error.textContent =
          caught instanceof Error ? caught.message : String(caught);
      } finally {
        renderRows();
      }
    })();
  });
  retryFailed.addEventListener("click", () => {
    retryFailed.disabled = true;
    error.textContent = "";
    void (async () => {
      try {
        const created: string[] = [];
        for (const task of tasks) {
          if (
            !task.jobId ||
            !["failed", "timeout", "canceled", "rejected"].includes(task.state)
          )
            continue;
          const response = await fetcher(
            `${origin}/admin/api/v1/jobs/${encodeURIComponent(task.jobId)}/retry`,
            {
              method: "POST",
              credentials: "same-origin",
              cache: "no-store",
              headers: {
                Accept: "application/json",
                "Content-Type": "application/json",
                "X-CSRF-Token": csrfToken,
                "Idempotency-Key": globalThis.crypto.randomUUID(),
              },
              body: "{}",
            },
          );
          const value = (await responseJson(response)) as { jobId?: unknown };
          if (typeof value.jobId !== "string")
            throw new Error("再実行Jobの応答が不正です。");
          created.push(value.jobId);
          task.message = `再実行: ${value.jobId}`;
        }
        status.textContent = `${created.length}件の再実行Jobを作成しました。`;
        renderRows();
      } catch (caught) {
        error.textContent =
          caught instanceof Error ? caught.message : String(caught);
        renderRows();
      }
    })();
  });
  globalThis.addEventListener("pagehide", () => {
    generation += 1;
    clearTickets();
    input.value = "";
    directory.value = "";
  });
  reset();
  void fetchAdminRenderTargets(fetcher, origin)
    .then((items) => {
      target.replaceChildren();
      if (items.length === 0) {
        target.append(new Option("利用できる実行先がありません", ""));
        status.textContent = "利用できる実行先がありません。";
        return;
      }
      target.append(new Option("実行先を選択してください", ""));
      for (const item of items)
        target.append(
          new Option(
            `${item.serviceAccountName} / ${item.apiKeyName}`,
            item.apiKeyId,
          ),
        );
      targetsReady = true;
      target.disabled = false;
      updateStart();
    })
    .catch((caught: unknown) => {
      target.replaceChildren(new Option("実行先を読み込めませんでした", ""));
      error.textContent =
        caught instanceof Error ? caught.message : String(caught);
    });
}

export const renderScript = `
(() => {
  const MAX_ZIP_BYTES = ${MAX_ZIP_BYTES};
  const JOB_ID_PATTERN = ${JOB_ID_PATTERN.toString()};
  const JOB_STATUSES = ${JSON.stringify(JOB_STATUSES)};
  const TERMINAL_JOB_STATUSES = new Set(${JSON.stringify([...TERMINAL_JOB_STATUSES])});
  const runBoundedBatch = ${runBoundedBatch.toString()};
  const crc32 = ${crc32.toString()};
  const inspectZipCandidates = ${inspectZipCandidates.toString()};
  const inspectZip = ${inspectZip.toString()};
  const zipSingleTex = ${zipSingleTex.toString()};
  const zipStoredFiles = ${zipStoredFiles.toString()};
  const sha256Hex = ${sha256Hex.toString()};
  const parseRenderTicket = ${parseRenderTicket.toString()};
  const parseJobArtifact = ${parseJobArtifact.toString()};
  const parseJobStatus = ${parseJobStatus.toString()};
  const responseError = ${responseError.toString()};
  const responseJson = ${responseJson.toString()};
  const parseAdminRenderTargets = ${parseAdminRenderTargets.toString()};
  const fetchAdminRenderTargets = ${fetchAdminRenderTargets.toString()};
  const createAdminRenderTicket = ${createAdminRenderTicket.toString()};
  const parseSourceTicket = ${parseSourceTicket.toString()};
  const createAdminSourceTicket = ${createAdminSourceTicket.toString()};
  const uploadSourceZip = ${uploadSourceZip.toString()};
  const createAdminSourceRef = ${createAdminSourceRef.toString()};
  const createAdminSourceRenderTicket = ${createAdminSourceRenderTicket.toString()};
  const uploadRenderZip = ${uploadRenderZip.toString()};
  const fetchRenderJob = ${fetchRenderJob.toString()};
  const cancelRenderJob = ${cancelRenderJob.toString()};
  const fetchRenderArtifact = ${fetchRenderArtifact.toString()};
  const formatBytes = ${formatBytes.toString()};
  const jobStatusLabel = ${jobStatusLabel.toString()};
  fetch('/auth/session',{credentials:'same-origin',cache:'no-store'}).then(async response=>{
    if(response.status===401){location.replace('/login/?return_to='+encodeURIComponent(location.pathname+location.search));return}
    const session=await response.json();
    if(!response.ok||typeof session.csrfToken!=='string')throw new Error(session?.error?.message||'ログインできませんでした。');
    (${installRenderWorkflow.toString()})(session.csrfToken);
  }).catch(error=>{const output=document.querySelector('#render-error');if(output)output.textContent=error instanceof Error?error.message:String(error)});
})();
`;
