import {
  constants,
  openSync,
  closeSync,
  readSync,
  writeSync,
  fsyncSync,
  fstatSync,
  opendirSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  X509Certificate,
} from "node:crypto";
import { lanHttpsPublicIdentity } from "./proof.mjs";
import { URL } from "node:url";
import { validateLanHttpsIssuedCertificate } from "./acme.mjs";
import { profileRecord } from "../../packages/server-setup-core/src/profile-shape.mjs";

const keyFiles = ["identity.pem", "account.pem", "tls-key.pem"];
const files = new Set([
  ...keyFiles,
  "accounts.json",
  "bundle.pem",
  "previous.pem",
  "order.json",
  "renewal.json",
  "identity.json",
  "invitation.json",
  "profiles.json",
  "tls-next.pem",
  "account-next.pem",
  "account-previous.pem",
  "account-rotation.json",
]);

export async function withLanHttpsClientLock(
  root,
  action,
  { lockFile = "client.lock" } = {},
) {
  if (!["client.lock", "operator.lock", "serve.lock"].includes(lockFile))
    throw new Error("Invalid LAN HTTPS lock name");
  const state = new LanHttpsClientState(root);
  const fd = openSync(
    join(root, lockFile),
    constants.O_RDWR |
      constants.O_CREAT |
      constants.O_NOFOLLOW |
      constants.O_NONBLOCK,
    0o600,
  );
  try {
    const stat = fstatSync(fd);
    if (
      !stat.isFile() ||
      stat.nlink !== 1 ||
      stat.uid !== process.geteuid() ||
      (stat.mode & 0o7777) !== 0o600
    )
      throw new Error("Unsafe LAN HTTPS publisher lock");
    // The child locks a duplicate of the parent's open file description.
    // Parent retains that description until the operation ends; a crash closes
    // it in the kernel. No PID/mtime records or stale lock-directory removal.
    const result = spawnSync(
      "/usr/bin/flock",
      ["--exclusive", "--nonblock", "--conflict-exit-code", "75", "3"],
      { stdio: ["ignore", "ignore", "ignore", fd], timeout: 5000 },
    );
    if (result.error || result.status !== 0)
      throw new Error(
        result.status === 75
          ? "LAN HTTPS publisher is busy"
          : "LAN HTTPS publisher lock failed",
      );
    return await action(state);
  } finally {
    closeSync(fd);
  }
}

// The service/CLI must hold the same OS flock around an entire enrollment or
// renewal. Atomic replacement protects readers, not two competing issuers.
export class LanHttpsClientState {
  #root;
  #uid;
  #write;
  #initialKeys;

  constructor(root, { writeBytes = writeSync, initialKeys = {} } = {}) {
    this.#initialKeys = initialKeys;
    if (
      typeof root !== "string" ||
      root !== resolve(root) ||
      typeof process.geteuid !== "function"
    )
      throw new Error(
        "LAN HTTPS state requires an absolute canonical POSIX directory",
      );
    this.#root = root;
    this.#uid = process.geteuid();
    this.#write = writeBytes;
    try {
      mkdirSync(root, { mode: 0o700 });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    this.#checkRoot();
  }

  #checkRoot() {
    const stat = lstatSync(this.#root);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      stat.uid !== this.#uid ||
      (stat.mode & 0o7777) !== 0o700 ||
      realpathSync(this.#root) !== this.#root
    )
      throw new Error(
        "LAN HTTPS state directory has unsafe ownership, mode or links",
      );
  }

  #path(name) {
    if (!files.has(name)) throw new Error("Unsupported LAN HTTPS state file");
    return join(this.#root, name);
  }

  read(name, maximumBytes = 528 * 1024) {
    this.#checkRoot();
    if (
      !Number.isSafeInteger(maximumBytes) ||
      maximumBytes < 1 ||
      maximumBytes > 528 * 1024
    )
      throw new Error("Invalid bounded LAN HTTPS state read");
    const path = this.#path(name);
    let fd;
    try {
      fd = openSync(
        path,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
    try {
      const before = fstatSync(fd);
      if (
        !before.isFile() ||
        before.nlink !== 1 ||
        before.uid !== this.#uid ||
        (before.mode & 0o7777) !== 0o600 ||
        before.size < 1 ||
        before.size > maximumBytes
      )
        throw new Error(
          "LAN HTTPS state file has unsafe ownership, mode, size or links",
        );
      const data = Buffer.alloc(before.size + 1);
      let size = 0;
      while (size < data.length) {
        const count = readSync(fd, data, size, data.length - size, null);
        if (!count) break;
        size += count;
      }
      const after = fstatSync(fd);
      if (
        size !== before.size ||
        after.size !== before.size ||
        after.ctimeMs !== before.ctimeMs ||
        after.mtimeMs !== before.mtimeMs
      )
        throw new Error("LAN HTTPS state changed while reading");
      return data.subarray(0, size);
    } finally {
      closeSync(fd);
    }
  }

  #atomic(name, bytes) {
    this.#checkRoot();
    if (
      !Buffer.isBuffer(bytes) ||
      bytes.length < 1 ||
      bytes.length > 528 * 1024
    )
      throw new Error("LAN HTTPS state write exceeds its bounded size");
    const destination = this.#path(name);
    // Refuse unsafe existing entries rather than replacing unexpected symlinks.
    this.read(name);
    const temporary = join(
      this.#root,
      `.update-${randomBytes(16).toString("hex")}`,
    );
    let fd;
    let failure;
    try {
      fd = openSync(
        temporary,
        constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_EXCL |
          constants.O_NOFOLLOW,
        0o600,
      );
      let offset = 0;
      while (offset < bytes.length) {
        const count = this.#write(
          fd,
          bytes,
          offset,
          bytes.length - offset,
          null,
        );
        if (
          !Number.isSafeInteger(count) ||
          count <= 0 ||
          count > bytes.length - offset
        )
          throw new Error("LAN HTTPS state write made no progress");
        offset += count;
      }
      fsyncSync(fd);
      closeSync(fd);
      fd = undefined;
      this.#checkRoot();
      renameSync(temporary, destination);
      const directory = openSync(
        this.#root,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
      );
      try {
        fsyncSync(directory);
      } finally {
        closeSync(directory);
      }
    } catch (error) {
      failure = error;
    } finally {
      if (fd !== undefined) {
        try {
          closeSync(fd);
        } catch (error) {
          failure ??= error;
        }
      }
      try {
        unlinkSync(temporary);
      } catch (error) {
        if (error.code !== "ENOENT") failure ??= error;
      }
    }
    if (failure) throw failure;
  }

  ensureIdentityKey() {
    let key = this.read("identity.pem", 16384);
    const metadata = this.read("identity.json", 4096);
    if (!key) {
      if (
        metadata ||
        this.read("accounts.json", 16384) ||
        this.read("bundle.pem")
      )
        throw new Error(
          "Referenced installation identity is missing; restore state",
        );
      key = this.#initialKeys["identity.pem"]
        ? Buffer.from(this.#initialKeys["identity.pem"])
        : Buffer.from(
            generateKeyPairSync("ed25519").privateKey.export({
              format: "pem",
              type: "pkcs8",
            }),
          );
      this.#atomic("identity.pem", key);
    }
    if (createPrivateKey(key).asymmetricKeyType !== "ed25519")
      throw new Error("Invalid installation identity");
    const publicKey = createPublicKey(key).export({ format: "jwk" });
    const identity = lanHttpsPublicIdentity({
      kty: publicKey.kty,
      crv: publicKey.crv,
      x: publicKey.x,
    });
    if (metadata) {
      try {
        const value = JSON.parse(metadata.toString());
        if (
          value.format !== 1 ||
          value.installationId !== identity.installationId ||
          Object.keys(value).length !== 2
        )
          throw new Error();
      } catch {
        throw new Error(
          "Saved installation identity is inconsistent; restore state",
        );
      }
    } else
      this.#atomic(
        "identity.json",
        Buffer.from(
          JSON.stringify({
            format: 1,
            installationId: identity.installationId,
          }),
        ),
      );
    if (
      this.#initialKeys["identity.pem"] &&
      !Buffer.from(this.#initialKeys["identity.pem"]).equals(key)
    )
      throw new Error(
        "Installation identity differs from its authority profile",
      );
    return key;
  }

  ensureAccountKey() {
    let key = this.read("account.pem", 16384);
    if (!key) {
      if (this.read("accounts.json", 16384) || this.read("order.json", 32768))
        throw new Error(
          "Referenced ACME account key is missing; restore state",
        );
      key = Buffer.from(
        generateKeyPairSync("ec", {
          namedCurve: "prime256v1",
        }).privateKey.export({ format: "pem", type: "pkcs8" }),
      );
      this.#atomic("account.pem", key);
    }
    const parsed = createPrivateKey(key);
    if (
      parsed.asymmetricKeyType !== "ec" ||
      parsed.asymmetricKeyDetails.namedCurve !== "prime256v1"
    )
      throw new Error("Invalid ACME account key");
    return key;
  }

  ensureKeys() {
    this.recoverTlsRotation();
    const existing = keyFiles.map((name) => this.read(name, 16384));
    const referenced =
      this.read("accounts.json", 16384) ||
      this.read("bundle.pem") ||
      this.read("order.json", 32768) ||
      this.read("renewal.json", 32768) ||
      this.read("identity.json", 4096);
    if (
      (!existing[0] && (existing[1] || existing[2] || referenced)) ||
      (!existing[1] && referenced) ||
      (!existing[2] && referenced)
    )
      throw new Error(
        "Referenced LAN HTTPS key is missing; restore the saved state instead of re-registering",
      );
    for (let i = 0; i < keyFiles.length; i++) {
      if (!existing[i]) {
        const generated =
          i === 0
            ? generateKeyPairSync("ed25519")
            : generateKeyPairSync("ec", { namedCurve: "prime256v1" });
        const pem = this.#initialKeys[keyFiles[i]]
          ? Buffer.from(this.#initialKeys[keyFiles[i]])
          : Buffer.from(
              generated.privateKey.export({ type: "pkcs8", format: "pem" }),
            );
        this.#atomic(keyFiles[i], pem);
        existing[i] = pem;
      }
      if (
        this.#initialKeys[keyFiles[i]] &&
        !Buffer.from(this.#initialKeys[keyFiles[i]]).equals(existing[i])
      )
        throw new Error(
          "Saved profile key differs from its installation authority; restore state",
        );
      const key = createPrivateKey(existing[i]);
      if (
        (i === 0 && key.asymmetricKeyType !== "ed25519") ||
        (i !== 0 &&
          (key.asymmetricKeyType !== "ec" ||
            key.asymmetricKeyDetails.namedCurve !== "prime256v1"))
      )
        throw new Error("LAN HTTPS state contains an unsupported private key");
    }
    const publicKey = createPublicKey(existing[0]).export({ format: "jwk" });
    const identity = lanHttpsPublicIdentity({
      kty: publicKey.kty,
      crv: publicKey.crv,
      x: publicKey.x,
    });
    const savedIdentity = this.read("identity.json", 4096);
    if (savedIdentity) {
      const value = JSON.parse(savedIdentity.toString());
      if (
        value.format !== 1 ||
        value.installationId !== identity.installationId ||
        Object.keys(value).length !== 2
      )
        throw new Error(
          "Saved installation identity is inconsistent; restore the saved state",
        );
    } else
      this.#atomic(
        "identity.json",
        Buffer.from(
          JSON.stringify({
            format: 1,
            installationId: identity.installationId,
          }),
        ),
      );
    return Object.freeze({
      identityKey: existing[0],
      accountKey: existing[1],
      tlsKey: existing[2],
    });
  }

  saveInvitation(code, serverOrigin) {
    const origin = new URL(serverOrigin);
    if (origin.protocol !== "https:" || origin.origin !== serverOrigin)
      throw new Error("Invalid invitation authority");
    if (
      typeof code !== "string" ||
      (code !== "" && !/^[A-Za-z0-9_-]{43}$/.test(code))
    )
      throw new Error("Invalid LAN invitation");
    this.#atomic(
      "invitation.json",
      Buffer.from(
        JSON.stringify({ format: 1, serverOrigin, invitationCode: code }),
      ),
    );
  }

  // Call only while holding the same OS flock as renewal. No mtime/PID guess:
  // an acquired flock proves that no cooperating publisher is still writing.
  // Repeated calls reclaim a bounded batch of crash leftovers.
  recoverTemporaryFiles() {
    this.#checkRoot();
    const directory = opendirSync(this.#root);
    const rootDevice = lstatSync(this.#root).dev;
    let removed = 0,
      scanned = 0;
    try {
      while (scanned < 4096 && removed < 256) {
        const entry = directory.readSync();
        if (!entry) break;
        scanned++;
        if (!/^\.update-[0-9a-f]{32}$/.test(entry.name)) continue;
        const path = join(this.#root, entry.name);
        const stat = lstatSync(path);
        if (
          !stat.isFile() ||
          stat.isSymbolicLink() ||
          stat.nlink !== 1 ||
          stat.uid !== this.#uid ||
          (stat.mode & 0o7777) !== 0o600 ||
          stat.dev !== rootDevice
        )
          throw new Error("Unsafe entry in LAN HTTPS temporary state");
        unlinkSync(path);
        removed++;
      }
    } finally {
      directory.closeSync();
    }
    return Object.freeze({ removed });
  }

  readAccounts() {
    const bytes = this.read("accounts.json", 16384);
    if (!bytes) return Object.freeze({});
    let value;
    try {
      value = JSON.parse(bytes.toString("utf8"));
      if (
        !value ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        Object.keys(value).length > 4
      )
        throw new Error();
      for (const [id, entry] of Object.entries(value)) {
        if (!/^[a-z][a-z0-9-]{0,31}$/.test(id)) throw new Error();
        profileRecord(entry, "saved ACME account", [
          "directoryUrl",
          "accountUrl",
        ]);
        const directory = new URL(entry.directoryUrl),
          account = new URL(entry.accountUrl);
        if (
          [directory, account].some(
            (url) =>
              url.protocol !== "https:" ||
              url.username ||
              url.password ||
              url.search ||
              url.hash,
          ) ||
          directory.origin !== account.origin
        )
          throw new Error();
        Object.freeze(entry);
      }
      return Object.freeze(value);
    } catch {
      throw new Error(
        "Saved LAN HTTPS accounts are invalid; state was retained",
      );
    }
  }

  saveAccount(id, directoryUrl, accountUrl) {
    if (
      typeof id !== "string" ||
      !/^[a-z][a-z0-9-]{0,31}$/.test(id) ||
      ["__proto__", "constructor", "prototype"].includes(id)
    )
      throw new Error("Invalid ACME issuer identity");
    const directory = new URL(directoryUrl),
      account = new URL(accountUrl);
    if (
      [directory, account].some(
        (url) =>
          url.protocol !== "https:" ||
          url.username ||
          url.password ||
          url.search ||
          url.hash,
      ) ||
      directory.origin !== account.origin
    )
      throw new Error("ACME account must match its configured authority");
    const accounts = {
      ...this.readAccounts(),
      [id]: { directoryUrl: directory.href, accountUrl: account.href },
    };
    if (Object.keys(accounts).length > 4)
      throw new Error("Saved ACME issuer capacity reached");
    this.#atomic("accounts.json", Buffer.from(JSON.stringify(accounts)));
  }

  // Only the schema-validating journal may write these bounded protocol records.
  // This intentionally cannot overwrite a key, bundle or account mapping.
  saveProtocolRecord(name, value) {
    if (
      ![
        "order.json",
        "renewal.json",
        "profiles.json",
        "account-rotation.json",
      ].includes(name)
    )
      throw new Error("Unsupported LAN HTTPS protocol record");
    const bytes = Buffer.from(JSON.stringify(value));
    if (bytes.length > 32768)
      throw new Error("LAN HTTPS protocol record exceeds its bounded size");
    this.#atomic(name, bytes);
  }

  async installCertificate(
    certificate,
    { hostnames, now, trustedCertificates, privateKey: selectedKey } = {},
  ) {
    const privateKey = selectedKey
      ? Buffer.from(selectedKey)
      : this.read("tls-key.pem", 16384);
    if (!privateKey) throw new Error("Persisted TLS private key is missing");
    const verified = await validateLanHttpsIssuedCertificate({
      certificate,
      privateKey,
      hostnames,
      ...(now === undefined ? {} : { now }),
      ...(trustedCertificates === undefined ? {} : { trustedCertificates }),
    });
    const previous = this.read("bundle.pem");
    const bundle = Buffer.concat([
      privateKey,
      Buffer.from("\n"),
      Buffer.from(certificate),
    ]);
    // Retain one previous verified generation; never accumulate dated copies.
    if (previous) this.#atomic("previous.pem", previous);
    this.#atomic("bundle.pem", bundle);
    this.recoverTlsRotation();
    return Object.freeze(verified);
  }

  #sameKey(a, b) {
    return createPublicKey(a)
      .export({ type: "spki", format: "der" })
      .equals(createPublicKey(b).export({ type: "spki", format: "der" }));
  }

  prepareTlsRotation() {
    this.ensureKeys();
    const order = this.read("order.json", 32768);
    if (order && JSON.parse(order.toString()).pending !== null)
      throw new Error(
        "Finish the pending certificate order before rotating its TLS key",
      );
    if (!this.read("bundle.pem"))
      throw new Error(
        "A published certificate is required before TLS key rotation",
      );
    return this.#prepareRotationKey("tls-next.pem");
  }

  #prepareRotationKey(name) {
    let key = this.read(name, 16384);
    if (!key) {
      key = Buffer.from(
        generateKeyPairSync("ec", {
          namedCurve: "prime256v1",
        }).privateKey.export({ type: "pkcs8", format: "pem" }),
      );
      this.#atomic(name, key);
    }
    const parsed = createPrivateKey(key);
    if (
      parsed.asymmetricKeyType !== "ec" ||
      parsed.asymmetricKeyDetails.namedCurve !== "prime256v1"
    )
      throw new Error("Invalid pending rotation key; restore state");
    return key;
  }

  recoverTlsRotation() {
    const next = this.read("tls-next.pem", 16384),
      bundle = this.read("bundle.pem");
    if (!next || !bundle) return;
    const active = bundle
      .toString()
      .match(
        /-----BEGIN PRIVATE KEY-----[\s\S]*?-----END PRIVATE KEY-----/,
      )?.[0];
    if (!active) throw new Error("Saved TLS bundle is missing its private key");
    if (!this.#sameKey(active, next)) return;
    const certificate = bundle
      .toString()
      .match(
        /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/,
      )?.[0];
    if (
      !certificate ||
      !new X509Certificate(certificate).checkPrivateKey(createPrivateKey(next))
    )
      throw new Error("Saved rotation bundle is inconsistent");
    this.#atomic("tls-key.pem", next);
    unlinkSync(this.#path("tls-next.pem"));
  }

  prepareAccountRotation() {
    return this.#prepareRotationKey("account-next.pem");
  }

  commitAccountRotation() {
    const next = this.read("account-next.pem", 16384),
      current = this.ensureAccountKey();
    if (!next) throw new Error("Missing pending ACME account key");
    if (!this.#sameKey(current, next)) {
      this.#atomic("account-previous.pem", current);
      this.#atomic("account.pem", next);
    }
  }

  synchronizeAccountRotation(previous, next) {
    const current = this.ensureAccountKey();
    if (this.#sameKey(current, next)) return;
    if (!previous || !this.#sameKey(current, previous))
      throw new Error(
        "Profile ACME account key does not match its rotation journal",
      );
    const order = this.read("order.json", 32768);
    if (order && JSON.parse(order.toString()).pending !== null)
      throw new Error("Pending profile order blocks account key rotation");
    this.#atomic("account.pem", Buffer.from(next));
  }

  finishAccountRotation() {
    this.read("account-next.pem", 16384);
    try {
      unlinkSync(this.#path("account-next.pem"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}
