import { lanHttpsBinary } from "./binary.mjs";
import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import {
  constants,
  openSync,
  closeSync,
  fstatSync,
  mkdirSync,
  lstatSync,
  realpathSync,
} from "node:fs";
import { join } from "node:path";
import { setInterval, clearInterval } from "node:timers";
import {
  validateLanHttpsAuthorityConfiguration,
  readLanHttpsConfiguration,
} from "./configuration.mjs";
import {
  LanHttpsAuthorityStore,
  LanHttpsAuthorityError,
} from "./authority-store.mjs";
import { createLanHttpsAuthorityHandler } from "./authority-http.mjs";
import { createLanHttpsDnsResponder, startLanHttpsDnsServer } from "./dns.mjs";
import { startLanHttpsSigner } from "./signer-process.mjs";
import { withLanHttpsClientLock } from "./client-state.mjs";

function openDatabase(root, initialize) {
  const path = join(root, "authority.sqlite");
  const flags =
    constants.O_RDWR |
    constants.O_NOFOLLOW |
    constants.O_NONBLOCK |
    (initialize ? constants.O_CREAT | constants.O_EXCL : 0);
  const fd = openSync(path, flags, 0o600);
  let before;
  try {
    before = fstatSync(fd);
    if (
      !before.isFile() ||
      before.nlink !== 1 ||
      before.uid !== process.geteuid() ||
      (before.mode & 0o7777) !== 0o600 ||
      before.size > 64 * 1024 * 1024
    )
      throw new Error("Unsafe dedicated authority database");
  } finally {
    closeSync(fd);
  }
  const db = new DatabaseSync(path, { enableForeignKeyConstraints: true });
  const after = lstatSync(path);
  if (
    after.ino !== before.ino ||
    after.dev !== before.dev ||
    after.isSymbolicLink()
  ) {
    db.close();
    throw new Error("Authority database changed during open");
  }
  return db;
}
function privateDirectory(root) {
  const stat = lstatSync(root);
  if (
    !stat.isDirectory() ||
    stat.uid !== process.geteuid() ||
    (stat.mode & 0o7777) !== 0o700 ||
    realpathSync(root) !== root
  )
    throw new Error(
      "Authority state requires a canonical service-owned 0700 directory",
    );
}
export function initializeLanHttpsAuthority(input) {
  const config = validateLanHttpsAuthorityConfiguration(input);
  try {
    mkdirSync(config.stateDirectory, { mode: 0o700 });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  privateDirectory(config.stateDirectory);
  const database = openDatabase(config.stateDirectory, true);
  try {
    const store = new LanHttpsAuthorityStore({
      database,
      policy: config.policy,
    });
    return Object.freeze({ initialized: true, counts: store.counts() });
  } finally {
    database.close();
  }
}
export function withLanHttpsAuthorityStore(input, action) {
  const config = validateLanHttpsAuthorityConfiguration(input);
  privateDirectory(config.stateDirectory);
  const database = openDatabase(config.stateDirectory, false);
  try {
    return action(
      new LanHttpsAuthorityStore({ database, policy: config.policy }),
    );
  } finally {
    database.close();
  }
}

// One process owns the API and UDP/TCP DNS. Ordinary address answers remain
// available even when protected state is unreadable; authenticated operations
// and DNS-01 fail closed. The API is never bound to a public HTTP address.
export async function startLanHttpsAuthority(
  input,
  { allowEphemeral = false, event = () => {}, signer } = {},
) {
  const config = validateLanHttpsAuthorityConfiguration(input, {
    allowEphemeral,
  });
  privateDirectory(config.stateDirectory);
  let unlock;
  const lifetime = new Promise((resolve) => {
    unlock = resolve;
  });
  let ready, rejectReady;
  const started = new Promise((resolve, reject) => {
    ready = resolve;
    rejectReady = reject;
  });
  const processLock = withLanHttpsClientLock(
    config.stateDirectory,
    async () => {
      let database,
        store,
        lastUnavailable = null;
      const health = (available) => {
        if (lastUnavailable === !available) return;
        lastUnavailable = !available;
        event({
          event: available
            ? "lan_https.authority_state_available"
            : "lan_https.authority_state_unavailable",
        });
      };
      const reconnect = () => {
        if (store) {
          try {
            store.gc();
            health(true);
            return;
          } catch {
            store = undefined;
            database?.close();
            database = undefined;
          }
        }
        try {
          database = openDatabase(config.stateDirectory, false);
          store = new LanHttpsAuthorityStore({
            database,
            policy: config.policy,
          });
          store.gc();
          health(true);
        } catch {
          store = undefined;
          database?.close();
          database = undefined;
          health(false);
        }
      };
      const facade = new Proxy(
        {},
        {
          get: (_, key) => {
            if (key === "policy") return config.policy;
            return (...args) => {
              if (!store)
                throw new LanHttpsAuthorityError("authority_unavailable", 503);
              return store[key](...args);
            };
          },
        },
      );
      const issuers = config.issuers.map(({ eabFile, ...issuer }) => {
        if (!eabFile) return { ...issuer, kid: null, hmacKey: null };
        const credentials = readLanHttpsConfiguration(eabFile, {
          secret: true,
          maximumBytes: 4096,
        });
        if (
          !credentials ||
          Object.keys(credentials).sort().join(",") !== "hmacKey,kid"
        )
          throw new Error("Invalid EAB credential file");
        return { ...issuer, ...credentials };
      });
      let ownedSigner,
        signerRefresh,
        signerTick,
        signerFailed = null;
      const refreshSigner = () => {
        if (signer || !config.keyless) return Promise.resolve();
        if (signerRefresh) return signerRefresh;
        signerRefresh = (async () => {
          try {
            if (ownedSigner?.running()) return;
            await ownedSigner?.close();
            ownedSigner = undefined;
            ownedSigner = await startLanHttpsSigner({
              ...config.keyless,
              binary: config.keyless.binary
                ? realpathSync(config.keyless.binary)
                : lanHttpsBinary(),
              stateDirectory: config.stateDirectory,
              domain: config.policy.lanDomain,
            });
            if (signerFailed !== false)
              event({ event: "lan_https.keyless_available" });
            signerFailed = false;
          } catch {
            ownedSigner = undefined;
            if (signerFailed !== true)
              event({ event: "lan_https.keyless_unavailable" });
            signerFailed = true;
          }
        })().finally(() => {
          signerRefresh = undefined;
        });
        return signerRefresh;
      };
      const activeSigner =
        signer ??
        (config.keyless
          ? {
              certificate: () => ownedSigner.certificate(),
              sign: (keyId, digest) => ownedSigner.sign(keyId, digest),
            }
          : null);
      const http = createServer(
        createLanHttpsAuthorityHandler({
          store: facade,
          issuers,
          trustLoopbackProxy: config.http.trustLoopbackProxy,
          ...(activeSigner ? { signer: activeSigner } : {}),
        }),
      );
      http.maxConnections = 32;
      http.maxHeadersCount = 40;
      http.headersTimeout = 5000;
      http.requestTimeout = 10000;
      http.keepAliveTimeout = 1000;
      http.maxRequestsPerSocket = 20;
      const dns = [];
      let timer;
      try {
        await refreshSigner();
        reconnect();
        const respond = createLanHttpsDnsResponder({
          domain: config.policy.lanDomain,
          nameserver: config.dns.nameserver,
          caaIssuers: config.dns.caaIssuers,
          challengeValues: (name) => facade.challengeValues(name),
        });
        for (const listener of config.dns.listeners)
          dns.push(
            await startLanHttpsDnsServer({
              host: listener.address,
              port: listener.port,
              respond,
            }),
          );
        await new Promise((resolve, reject) => {
          http.once("error", reject);
          http.listen(config.http.port, config.http.address, () => {
            http.off("error", reject);
            resolve();
          });
        });
        http.on("error", () =>
          event({ event: "lan_https.authority_http_error" }),
        );
        signerTick = setInterval(() => {
          void refreshSigner();
        }, 60000);
        signerTick.unref();
        timer = setInterval(reconnect, 15 * 60_000);
        timer.unref();
        ready(
          Object.freeze({
            httpPort: http.address().port,
            dnsPorts: Object.freeze(dns.map((server) => server.port)),
            close: async () => {
              unlock();
              await processLock;
            },
          }),
        );
        await lifetime;
      } finally {
        if (timer) clearInterval(timer);
        if (signerTick) clearInterval(signerTick);
        await signerRefresh;
        http.closeAllConnections();
        if (http.listening) await new Promise((resolve) => http.close(resolve));
        for (const server of dns) await server.close();
        database?.close();
        await ownedSigner?.close();
      }
    },
  );
  void processLock.catch(rejectReady);
  return started;
}
