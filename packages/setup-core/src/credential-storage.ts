import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { chmod, mkdir, open, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { AppError } from "@latex-renderer/shared";
import { runWindowsCredential } from "./windows-credential.js";

export interface CredentialFile {
  readonly platform: "linux" | "darwin" | "win32";
  readonly path: string;
  readonly env: NodeJS.ProcessEnv;
}

export async function writeCredentialFile(
  { platform, path, env }: CredentialFile,
  secret: string,
): Promise<void> {
  if (!/^lrk_[a-f0-9]{32}_[A-Za-z0-9_-]{43}$/.test(secret))
    throw new AppError("INVALID_API_KEY", "Input is not a render API key", 400);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.part-${randomUUID()}`;
  try {
    if (platform === "win32")
      runWindowsCredential("save", temporary, env, secret);
    else {
      await writeFile(temporary, secret, { mode: 0o600, flag: "wx" });
      await chmod(temporary, 0o600);
    }
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function readCredentialFile({
  platform,
  path,
  env,
}: CredentialFile): Promise<string> {
  if (platform === "win32") return runWindowsCredential("load", path, env);
  const file = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  ).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === "ELOOP")
      throw permissionsError();
    throw error;
  });
  try {
    const info = await file.stat();
    if (
      !info.isFile() ||
      info.mode & 0o077 ||
      info.uid !== (process.geteuid?.() ?? info.uid)
    )
      throw permissionsError();
    return (await file.readFile("utf8")).trim();
  } finally {
    await file.close();
  }
}

function permissionsError(): AppError {
  return new AppError(
    "CREDENTIAL_PERMISSIONS",
    "Credential file must be a regular file owned by the current user with mode 0600",
    401,
  );
}
