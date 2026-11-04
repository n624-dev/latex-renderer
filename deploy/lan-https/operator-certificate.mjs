import {
  openSync,
  closeSync,
  writeSync,
  fsyncSync,
  renameSync,
  unlinkSync,
  constants,
  lstatSync,
  realpathSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { withLanHttpsClientLock } from "./client-state.mjs";
import { validateLanHttpsIssuedCertificate } from "./acme.mjs";
import { readLanHttpsBytes } from "./configuration.mjs";

export async function installLanHttpsOperatorCertificate({
  config,
  certificateFile,
  keyFile,
  trustedCertificates,
  writeBytes = writeSync,
}) {
  if (!config.keyless)
    throw new Error("Configure the operator Keyless bundle path first");
  // ACME tools commonly maintain live/ symlinks. Resolve those explicit source
  // arguments once, then perform the same no-follow descriptor checks.
  const certificate = readLanHttpsBytes(realpathSync(certificateFile), {
    maximumBytes: 512 * 1024,
  });
  const key = readLanHttpsBytes(realpathSync(keyFile), {
    secret: true,
    maximumBytes: 16384,
  });
  const verified = await validateLanHttpsIssuedCertificate({
    certificate: certificate.toString("utf8"),
    privateKey: key,
    hostnames: ["*." + config.policy.lanDomain],
    purpose: "keyless-operator",
    ...(trustedCertificates ? { trustedCertificates } : {}),
  });
  const output = config.keyless.bundleFile,
    root = dirname(output),
    stat = lstatSync(root);
  if (
    !stat.isDirectory() ||
    stat.uid !== process.geteuid() ||
    (stat.mode & 0o7777) !== 0o700 ||
    realpathSync(root) !== root
  )
    throw new Error(
      "Operator certificate destination must be private and service-owned",
    );
  try {
    readLanHttpsBytes(output, { secret: true, maximumBytes: 528 * 1024 });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return withLanHttpsClientLock(
    root,
    async () => {
      const temporary = join(root, ".operator-certificate.pending");
      try {
        const pending = lstatSync(temporary);
        if (
          !pending.isFile() ||
          pending.isSymbolicLink() ||
          pending.uid !== process.geteuid() ||
          pending.nlink !== 1 ||
          pending.dev !== stat.dev ||
          (pending.mode & 0o7777) !== 0o600 ||
          pending.size > 528 * 1024
        )
          throw new Error("Unsafe interrupted operator certificate");
        unlinkSync(temporary);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      let fd, failure;
      try {
        fd = openSync(
          temporary,
          constants.O_WRONLY |
            constants.O_CREAT |
            constants.O_EXCL |
            constants.O_NOFOLLOW,
          0o600,
        );
        const bytes = Buffer.concat([key, Buffer.from("\n"), certificate]);
        let offset = 0;
        while (offset < bytes.length) {
          const count = writeBytes(
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
            throw new Error("Certificate write made no progress");
          offset += count;
        }
        fsyncSync(fd);
        closeSync(fd);
        fd = undefined;
        renameSync(temporary, output);
        const directory = openSync(
          root,
          constants.O_RDONLY | constants.O_DIRECTORY,
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
      return Object.freeze(verified);
    },
    { lockFile: "operator.lock" },
  );
}
