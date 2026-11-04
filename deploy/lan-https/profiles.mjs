import { createHash } from "node:crypto";
import {
  mkdirSync,
  lstatSync,
  realpathSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  rmdirSync,
} from "node:fs";
import { join, dirname } from "node:path";
import {
  LanHttpsClientState,
  withLanHttpsClientLock,
} from "./client-state.mjs";
import { validateLanHttpsProvider } from "../../packages/server-setup-core/src/lan-https.mjs";

const digest = (values) =>
  createHash("sha256").update(JSON.stringify(values)).digest("hex");
export function lanHttpsProfileId(provider, issuerId) {
  const checked = validateLanHttpsProvider(provider);
  if (!/^[a-z][a-z0-9-]{0,31}$/.test(issuerId))
    throw new Error("Invalid profile issuer");
  return digest([
    checked.serverOrigin,
    checked.lanDomain,
    checked.publicOrigin,
    issuerId,
  ]);
}
function directory(path) {
  try {
    mkdirSync(path, { mode: 0o700 });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  const stat = lstatSync(path);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    stat.uid !== process.geteuid() ||
    (stat.mode & 0o7777) !== 0o700 ||
    realpathSync(path) !== path
  )
    throw new Error("Unsafe private LAN profile directory");
}
function readIndex(state) {
  const bytes = state.read("profiles.json", 32768);
  if (!bytes) return { format: 1, current: null, previous: null, profiles: [] };
  try {
    const value = JSON.parse(bytes.toString());
    if (
      value.format !== 1 ||
      Object.keys(value).sort().join(",") !==
        "current,format,previous,profiles" ||
      !Array.isArray(value.profiles) ||
      value.profiles.length > 8 ||
      ![value.current, value.previous].every(
        (id) =>
          id === null || (typeof id === "string" && /^[a-f0-9]{64}$/.test(id)),
      ) ||
      value.profiles.some(
        (p) =>
          !p ||
          Object.keys(p).sort().join(",") !== "group,id,lastUsed" ||
          !/^[a-f0-9]{64}$/.test(p.id) ||
          !/^[a-f0-9]{64}$/.test(p.group) ||
          !Number.isSafeInteger(p.lastUsed) ||
          p.lastUsed < 0,
      ) ||
      new Set(value.profiles.map((p) => p.id)).size !== value.profiles.length ||
      [value.current, value.previous].some(
        (id) => id !== null && !value.profiles.some((p) => p.id === id),
      )
    )
      throw new Error();
    return value;
  } catch {
    throw new Error("Saved LAN profile index is corrupt; state was retained");
  }
}
function removeProfile(path) {
  const mounts = readFileSync("/proc/self/mountinfo", "utf8");
  if (Buffer.byteLength(mounts) > 4 * 1024 * 1024)
    throw new Error("Cannot verify LAN profile mounts");
  if (
    mounts.split("\n").some((line) => {
      const mount = line
        .split(" ")[4]
        ?.replace(/\\([0-7]{3})/g, (_, code) =>
          String.fromCharCode(parseInt(code, 8)),
        );
      return mount === path || mount?.startsWith(path + "/");
    })
  )
    throw new Error("Unexpected mount in retired LAN profile");
  const root = lstatSync(path);
  if (root.dev !== lstatSync(dirname(path)).dev)
    throw new Error("Retired LAN profile crosses a filesystem");
  if (
    !root.isDirectory() ||
    root.isSymbolicLink() ||
    root.uid !== process.geteuid() ||
    (root.mode & 0o7777) !== 0o700 ||
    realpathSync(path) !== path
  )
    throw new Error("Unsafe retired LAN profile");
  const names = readdirSync(path);
  if (names.length > 64)
    throw new Error("Unexpected retired LAN profile entries");
  for (const name of names) {
    if (
      !/^(?:identity|account|tls-key|tls-previous|tls-next|bundle|previous)\.pem$|^(?:identity|accounts|invitation|order|renewal)\.json$|^(?:client|serve|operator)\.lock$|^\.update-[a-f0-9]{32}$/.test(
        name,
      )
    )
      throw new Error("Unexpected LAN profile entry");
    const stat = lstatSync(join(path, name));
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.uid !== root.uid ||
      stat.nlink !== 1 ||
      stat.dev !== root.dev ||
      (stat.mode & 0o7777) !== 0o600
    )
      throw new Error("Unsafe retired LAN profile entry");
  }
  for (const name of names) unlinkSync(join(path, name));
  rmdirSync(path);
}
async function collectProfiles(index, rootState, profiles) {
  for (const retired of [...index.profiles].sort(
    (a, b) => a.lastUsed - b.lastUsed,
  )) {
    if (index.profiles.length <= 3) break;
    if ([index.current, index.previous].includes(retired.id)) continue;
    const retiredRoot = join(profiles, retired.id);
    try {
      await withLanHttpsClientLock(retiredRoot, async () =>
        withLanHttpsClientLock(
          retiredRoot,
          async () => {
            // Remove from the durable index before deleting files. A crash can
            // leave a bounded unreferenced profile, recovered on the next call.
            index.profiles = index.profiles.filter((p) => p.id !== retired.id);
            rootState.saveProtocolRecord("profiles.json", index);
            removeProfile(retiredRoot);
          },
          { lockFile: "serve.lock" },
        ),
      );
    } catch (error) {
      if (!/publisher is busy/.test(error.message)) throw error;
    }
  }
}

// Root lock serializes configuration/CA changes. Per-profile publisher and
// shared bridge locks additionally protect readers from bounded profile GC.
export async function withLanHttpsProfile(
  config,
  action,
  { allowAccountRotation = false } = {},
) {
  return withLanHttpsClientLock(config.stateDirectory, async (rootState) => {
    const identityKey = rootState.ensureIdentityKey();
    if (!rootState.read("invitation.json", 4096)) rootState.saveInvitation("");
    const authorities = join(config.stateDirectory, "authorities"),
      profiles = join(config.stateDirectory, "profiles");
    directory(authorities);
    directory(profiles);
    const group = digest([config.provider.serverOrigin]);
    const id = lanHttpsProfileId(config.provider, config.issuerId);
    const index = readIndex(rootState);
    const entries = readdirSync(profiles);
    if (entries.length > 16)
      throw new Error("LAN profile recovery capacity exceeded");
    for (const orphan of entries) {
      if (!/^[a-f0-9]{64}$/.test(orphan))
        throw new Error("Unexpected LAN profile path");
      if (index.profiles.some((p) => p.id === orphan)) continue;
      const path = join(profiles, orphan);
      try {
        await withLanHttpsClientLock(path, async () =>
          withLanHttpsClientLock(path, async () => removeProfile(path), {
            lockFile: "serve.lock",
          }),
        );
      } catch (error) {
        if (!/publisher is busy/.test(error.message)) throw error;
      }
    }
    await collectProfiles(index, rootState, profiles);
    if (!index.profiles.some((p) => p.id === id) && index.profiles.length >= 8)
      throw new Error("Protected LAN profile capacity reached");
    if (
      !readdirSync(authorities).includes(group) &&
      readdirSync(authorities).length >= 4
    )
      throw new Error("LAN authority capacity reached");
    const groupRoot = join(authorities, group);
    directory(groupRoot);
    const groupState = new LanHttpsClientState(groupRoot, {
      initialKeys: { "identity.pem": identityKey },
    });
    groupState.ensureIdentityKey();
    if (
      index.profiles.some((profile) => profile.group === group) &&
      !groupState.read("account.pem", 16384)
    )
      throw new Error(
        "Referenced authority account key is missing; restore matching state",
      );
    const rotation = groupState.read("account-rotation.json", 32768);
    if (
      rotation &&
      JSON.parse(rotation.toString()).phase !== "done" &&
      !allowAccountRotation
    )
      throw new Error(
        "Resume the pending ACME account key rotation before renewing",
      );
    const accountKey = groupState.ensureAccountKey();
    const profileRoot = join(profiles, id);
    directory(profileRoot);
    const state = new LanHttpsClientState(profileRoot, {
      initialKeys: { "identity.pem": identityKey, "account.pem": accountKey },
    });
    if (state.read("account.pem", 16384))
      state.synchronizeAccountRotation(
        groupState.read("account-previous.pem", 16384),
        accountKey,
      );
    state.ensureKeys();
    for (const [issuer, value] of Object.entries(groupState.readAccounts()))
      if (!state.readAccounts()[issuer])
        state.saveAccount(issuer, value.directoryUrl, value.accountUrl);
    if (index.current !== id) {
      index.previous = index.current;
      index.current = id;
    }
    let entry = index.profiles.find((p) => p.id === id);
    if (!entry) {
      entry = { id, group, lastUsed: Date.now() };
      index.profiles.push(entry);
    }
    entry.lastUsed = Date.now();
    rootState.saveProtocolRecord("profiles.json", index);
    await collectProfiles(index, rootState, profiles);
    return action({
      rootState,
      state,
      profileRoot,
      groupState,
      id,
      installationId: JSON.parse(
        rootState.read("identity.json", 4096).toString(),
      ).installationId,
    });
  });
}

// Inspection must not select a profile, generate keys, enroll or issue a certificate.
export async function withExistingLanHttpsProfile(config, action) {
  const stat = lstatSync(config.stateDirectory);
  if (!stat.isDirectory()) throw new Error("LAN client is not initialized");
  return withLanHttpsClientLock(config.stateDirectory, async (rootState) => {
    const id = lanHttpsProfileId(config.provider, config.issuerId);
    const index = readIndex(rootState);
    if (!index.profiles.some((profile) => profile.id === id))
      throw new Error("Selected LAN profile is not initialized");
    const profileRoot = join(config.stateDirectory, "profiles", id);
    const stat = lstatSync(profileRoot);
    if (!stat.isDirectory())
      throw new Error("Saved LAN profile is missing; restore state");
    return action({
      state: new LanHttpsClientState(profileRoot),
      profileRoot,
      id,
    });
  });
}
