import { createPrivateKey, randomBytes } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  rmdir,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { createAgentEnrollmentClient } from "./enrollment-http.js";
import {
  configureAgentEnrollment,
  createAgentEnrollmentKeys,
} from "./enrollment.js";

const [action, gatewayOrigin, directory, ...extra] = process.argv.slice(2);
const rotate = extra.length === 1 && extra[0] === "--rotate-agent-key";
if (action === "--skip" && gatewayOrigin === undefined) {
  console.log("ChatGPT integration skipped. You can enable it later.");
} else if (
  action === "--retire-key" &&
  gatewayOrigin &&
  directory === undefined
) {
  await retireKey(gatewayOrigin);
} else if (
  action === "--connect" &&
  gatewayOrigin &&
  directory &&
  (extra.length === 0 || rotate)
) {
  await connect(gatewayOrigin, directory, rotate);
} else {
  throw new Error(
    "Usage: setup.js --skip | --connect GATEWAY_HTTPS_ORIGIN ABSOLUTE_PRIVATE_DIRECTORY [--rotate-agent-key]",
  );
}

async function retireKey(directory: string): Promise<void> {
  const limits = await readFile(join(directory, "agent-limits.env"), "utf8");
  const port = Number(
    /^RENDERER_RELAY_AGENT_PORT=(\d{1,5})$/m.exec(limits)?.[1],
  );
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid agent port");
  const secret = (
    await readFile(join(directory, "admin-secret"), "utf8")
  ).trim();
  if (!/^[A-Za-z0-9_-]{43}$/.test(secret))
    throw new Error("Invalid agent credential");
  const response = await fetch(`http://127.0.0.1:${port}/agent/retire`, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
    headers: { Authorization: `Bearer ${secret}` },
  });
  const result: unknown = await response.json();
  if (
    !response.ok ||
    !result ||
    typeof result !== "object" ||
    !("retired" in result) ||
    result.retired !== true
  )
    throw new Error(
      "The gateway did not confirm key retirement. Revoke it before considering it inactive.",
    );
  console.log(
    "The gateway retired this agent key. Enroll a new key to reconnect.",
  );
}

async function connect(
  origin: string,
  directory: string,
  rotate: boolean,
): Promise<void> {
  const client = createAgentEnrollmentClient(origin, 8192);
  if (!isAbsolute(directory) || !/^\/[A-Za-z0-9._/-]+$/.test(directory))
    throw new Error("An absolute private configuration directory is required");
  await mkdir(directory, { mode: 0o700 }).catch((error: unknown) => {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "EEXIST"
    )
      throw error;
  });
  const owner = process.getuid?.();
  const info = await lstat(directory);
  if (
    !info.isDirectory() ||
    info.uid !== owner ||
    (info.mode & 0o077) !== 0 ||
    (await realpath(directory)) !== directory
  )
    throw new Error(
      "The configuration directory must be private and owned by the setup user",
    );

  const lock = join(directory, ".enrollment");
  const stagedEnvironment = join(directory, "agent.env.pending");
  try {
    // Serialize enrollments so concurrent setup cannot replace an active key.
    await mkdir(lock, { mode: 0o700 });
  } catch {
    throw new Error(
      "An enrollment is in progress. After an interrupted enrollment, remove the empty .enrollment directory before retrying.",
    );
  }
  try {
    await rm(stagedEnvironment, { force: true });
    const generated = createAgentEnrollmentKeys();
    const identity = await readOrCreate(
      join(directory, "instance-id"),
      generated.instanceId,
    );
    const instanceKey = join(directory, "instance.pem"),
      agentKey = join(directory, "agent.pem");
    const pendingKey = join(directory, "agent.pem.pending");
    const replacement = await lstat(pendingKey).then(
      () => true,
      (error: unknown) => {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        )
          return false;
        throw error;
      },
    );
    const selectedKey = rotate || replacement ? pendingKey : agentKey;
    const sharedSecret = join(directory, "local-secret");
    const keys = {
      instanceId: identity.trim(),
      instancePrivateKey: createPrivateKey(
        await readOrCreate(
          instanceKey,
          generated.instancePrivateKey.export({ type: "pkcs8", format: "pem" }),
        ),
      ),
      agentPrivateKey: createPrivateKey(
        await readOrCreate(
          selectedKey,
          generated.agentPrivateKey.export({ type: "pkcs8", format: "pem" }),
        ),
      ),
    };
    await readOrCreate(sharedSecret, randomBytes(32).toString("base64url"));
    await readOrCreate(
      join(directory, "admin-secret"),
      randomBytes(32).toString("base64url"),
    );
    if (!/^instance_[a-f0-9]{32}$/.test(keys.instanceId))
      throw new Error("Invalid Renderer installation identity");
    const registration = await configureAgentEnrollment(
      "connect",
      () => ({ gatewayOrigin: origin, keys, client }),
      AbortSignal.timeout(60_000),
    );
    if (registration.status !== "registered")
      throw new Error("Agent registration did not complete");
    const environment = {
      RENDERER_RELAY_INSTANCE_ID: keys.instanceId,
      RENDERER_RELAY_GATEWAY_ORIGIN: origin,
      RENDERER_RELAY_TRANSPORT_ID: registration.transportId,
    };
    await writeFile(
      stagedEnvironment,
      Object.entries(environment)
        .map(([key, value]) => `${key}=${value}\n`)
        .join(""),
      { flag: "wx", mode: 0o600 },
    );
    if (selectedKey === pendingKey) await rename(pendingKey, agentKey);
    await rename(stagedEnvironment, join(directory, "agent.env"));
    console.log(
      "Agent registered. The credential and environment files are ready for service installation.",
    );
  } finally {
    await rm(stagedEnvironment, { force: true });
    await rmdir(lock);
  }
}

async function readOrCreate(path: string, content: string): Promise<string> {
  try {
    await writeFile(path, content + "\n", { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "EEXIST"
    )
      throw error;
  }
  const info = await lstat(path);
  if (
    !info.isFile() ||
    info.uid !== process.getuid?.() ||
    (info.mode & 0o077) !== 0 ||
    info.size > 8192
  )
    throw new Error("Unsafe agent credential file");
  return readFile(path, "utf8");
}
