import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  link,
  lstat,
  mkdir,
  open,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  AppError,
  clientRendererOverride,
  credentialUrl,
  PUBLIC_ORIGIN,
} from "@latex-renderer/shared";
import {
  readCredentialFile,
  type CredentialFile,
} from "./credential-storage.js";
import { runWindowsCredential } from "./windows-credential.js";

const namePattern = /^[a-z0-9][a-z0-9-]{0,30}$/;
const keyPattern = /^lrk_[a-f0-9]{32}_[A-Za-z0-9_-]{43}$/;
const prefix = "profile-";

interface SavedProfile {
  origin: string;
  credential: string;
}

export interface RendererConnection {
  name?: string;
  origin: string;
  apiKey: string;
  credentialSource: "profile" | "environment";
}

export function rendererConnectionProfiles(legacy: CredentialFile) {
  const root = join(dirname(legacy.path), "connections");
  const active = join(root, "default");
  const path = (name: string) =>
    join(root, `${prefix}${validateName(name)}.json`);

  async function read(name: string): Promise<SavedProfile | undefined> {
    const content = await readPrivate(path(name), legacy.platform);
    if (content === undefined) return;
    let metadata: unknown;
    try {
      metadata = JSON.parse(content);
    } catch {
      throw invalidProfile();
    }
    if (
      !metadata ||
      typeof metadata !== "object" ||
      !("origin" in metadata) ||
      typeof metadata.origin !== "string" ||
      !("credential" in metadata) ||
      typeof metadata.credential !== "string" ||
      !(legacy.platform === "win32"
        ? /^[0-9a-f]+$/i.test(metadata.credential)
        : keyPattern.test(metadata.credential))
    )
      throw invalidProfile();
    const origin = credentialUrl(metadata.origin).origin;
    if (origin !== metadata.origin) throw invalidProfile();
    return { origin, credential: metadata.credential };
  }

  async function defaultName(): Promise<string | undefined> {
    const value = await readPrivate(active, legacy.platform);
    return value === undefined ? undefined : validateName(value.trim());
  }

  async function select(name: string): Promise<void> {
    if (!(await read(name))) throw missingProfile(name);
    await writePrivate(active, name + "\n");
  }

  async function save(name: string, url: string, key: string): Promise<void> {
    const target = path(name);
    const origin = credentialUrl(url).origin;
    if (!keyPattern.test(key))
      throw new AppError(
        "INVALID_API_KEY",
        "Input is not a render API key",
        400,
      );
    const existing = await read(name);
    if (existing && existing.origin !== origin)
      throw new AppError(
        "PROFILE_ORIGIN_CONFLICT",
        "A connection with this name belongs to a different server",
        409,
      );
    const credential =
      legacy.platform === "win32"
        ? runWindowsCredential("protect", "", legacy.env, key)
        : key;
    const content = JSON.stringify({ origin, credential }) + "\n";
    if (existing) await writePrivate(target, content);
    else {
      try {
        await writePrivate(target, content, true);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        throw new AppError(
          "PROFILE_CHANGED",
          "This connection was just created. Review it and try again.",
          409,
        );
      }
    }
    if (!(await defaultName())) await select(name);
  }

  return {
    save,
    select,
    async target(explicit?: string, url?: string) {
      const name =
        explicit ??
        legacy.env.LATEX_RENDER_PROFILE ??
        (await defaultName()) ??
        "default";
      const profile = await read(name);
      const origin = credentialUrl(
        url ?? profile?.origin ?? PUBLIC_ORIGIN,
      ).origin;
      if (profile && profile.origin !== origin)
        throw new AppError(
          "PROFILE_ORIGIN_CONFLICT",
          "The selected connection belongs to a different server",
          409,
        );
      return { name, origin };
    },
    async migrate(name: string, url: string) {
      // Read the existing file only after the caller has chosen its origin.
      await save(name, url, await readCredentialFile(legacy));
    },
    async list() {
      const [names, selected] = await Promise.all([
        readdir(root).catch((error: unknown) => {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
          throw error;
        }),
        defaultName(),
      ]);
      const connections = [];
      for (const entry of names.sort()) {
        if (!entry.startsWith(prefix) || !entry.endsWith(".json")) continue;
        const name = entry.slice(prefix.length, -5);
        if (!namePattern.test(name)) continue;
        const profile = await read(name);
        if (profile)
          connections.push({
            name,
            origin: profile.origin,
            default: name === selected,
          });
      }
      return connections;
    },
    async remove(name: string) {
      await rm(path(name), { force: true });
      if ((await defaultName()) === name) await rm(active, { force: true });
    },
    async resolve(
      explicit?: string,
      requestedUrl?: string,
    ): Promise<RendererConnection> {
      const selected = explicit ?? legacy.env.LATEX_RENDER_PROFILE;
      const environmentKey = legacy.env.LATEX_RENDER_API_KEY;
      const override = requestedUrl ?? clientRendererOverride(legacy.env);
      if (selected === undefined && environmentKey !== undefined)
        return {
          origin: credentialUrl(override ?? PUBLIC_ORIGIN).origin,
          apiKey: environmentKey,
          credentialSource: "environment",
        };
      const name = selected ?? (await defaultName());
      if (!name) {
        const existing = await lstat(legacy.path).catch((error: unknown) => {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        });
        if (existing)
          throw new AppError(
            "CONNECTION_CONFIRMATION_REQUIRED",
            "Confirm the server for your saved API key with n624-latex connection",
            401,
          );
        throw new AppError(
          "CREDENTIAL_NOT_FOUND",
          "No renderer connection is configured",
          401,
        );
      }
      const profile = await read(name);
      if (!profile) throw missingProfile(name);
      if (
        (requestedUrl !== undefined || selected === undefined) &&
        override !== undefined &&
        credentialUrl(override).origin !== profile.origin
      )
        throw new AppError(
          "PROFILE_ORIGIN_CONFLICT",
          "The requested server differs from the server for the saved API key. Select its connection explicitly.",
          400,
        );
      return {
        name,
        origin: profile.origin,
        apiKey:
          legacy.platform === "win32"
            ? runWindowsCredential(
                "unprotect",
                "",
                legacy.env,
                profile.credential,
              )
            : profile.credential,
        credentialSource: "profile",
      };
    },
    defaultName,
  };
}

function validateName(name: string): string {
  if (!namePattern.test(name))
    throw new AppError(
      "INVALID_PROFILE_NAME",
      "Connection names must use lowercase letters, numbers, and hyphens",
      400,
    );
  return name;
}

function missingProfile(name: string): AppError {
  return new AppError(
    "CONNECTION_NOT_FOUND",
    `No renderer connection named ${name}`,
    404,
  );
}

function invalidProfile(): AppError {
  return new AppError(
    "INVALID_PROFILE",
    "The saved renderer connection is invalid",
    400,
  );
}

async function readPrivate(path: string, platform: CredentialFile["platform"]) {
  const file = await open(
    path,
    constants.O_RDONLY |
      (platform === "win32" ? 0 : constants.O_NOFOLLOW | constants.O_NONBLOCK),
  ).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  });
  if (!file) return;
  try {
    const info = await file.stat();
    if (
      !info.isFile() ||
      info.size > 16_384 ||
      (platform !== "win32" &&
        Boolean(info.mode & 0o077 || info.uid !== process.geteuid?.()))
    )
      throw invalidProfile();
    return await file.readFile("utf8");
  } finally {
    await file.close();
  }
}

async function writePrivate(path: string, value: string, create = false) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.part-${randomUUID()}`;
  try {
    await writeFile(temporary, value, { mode: 0o600, flag: "wx" });
    if (create) await link(temporary, path);
    else await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}
