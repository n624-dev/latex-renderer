import { spawn } from "node:child_process";
import { request } from "node:http";
import { lstatSync, realpathSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { setTimeout, clearTimeout } from "node:timers";

// The signer owns its TLS key in a separate standard-library process. The Unix
// socket and directory are private to the authority identity, never HTTP-public.
export async function startLanHttpsSigner({
  binary,
  bundleFile,
  stateDirectory,
  domain,
}) {
  const executable = lstatSync(binary);
  if (
    !executable.isFile() ||
    executable.isSymbolicLink() ||
    executable.nlink !== 1 ||
    ![0, process.geteuid()].includes(executable.uid) ||
    executable.mode & 0o022 ||
    !(executable.mode & 0o111) ||
    realpathSync(binary) !== binary
  )
    throw new Error("Unsafe LAN HTTPS signer executable");
  const socketPath = join(stateDirectory, "signer.sock");
  const child = spawn(
    binary,
    [
      "signer",
      "--bundle",
      bundleFile,
      "--socket",
      socketPath,
      "--domain",
      domain,
    ],
    {
      stdio: ["ignore", "pipe", "ignore"],
      env: {
        PATH: "/usr/bin:/bin",
        GOMAXPROCS: "1",
        GOMEMLIMIT: "32MiB",
        ...(process.env.SSL_CERT_FILE
          ? { SSL_CERT_FILE: process.env.SSL_CERT_FILE }
          : {}),
        ...(process.env.SSL_CERT_DIR
          ? { SSL_CERT_DIR: process.env.SSL_CERT_DIR }
          : {}),
      },
    },
  );
  const exited = new Promise((resolve) => child.once("close", resolve));
  try {
    await new Promise((resolve, reject) => {
      let output = "";
      const timer = setTimeout(
        () => reject(new Error("Signer startup deadline")),
        5000,
      );
      const finish = (error) => {
        clearTimeout(timer);
        child.stdout.off("data", data);
        if (error) reject(error);
        else resolve();
      };
      const data = (chunk) => {
        output += chunk.toString("utf8");
        if (output.length > 256)
          return finish(new Error("Invalid signer startup response"));
        if (output.includes("\n")) {
          try {
            if (JSON.parse(output.trim()).ready !== true) throw new Error();
            finish();
          } catch {
            finish(new Error("Invalid signer startup response"));
          }
        }
      };
      child.stdout.on("data", data);
      child.once("error", () => finish(new Error("Signer could not start")));
      child.once("exit", () =>
        finish(new Error("Signer exited during startup")),
      );
    });
  } catch (error) {
    child.kill("SIGKILL");
    await exited;
    throw error;
  }
  child.stdout.resume();
  function call(path, body) {
    return new Promise((resolve, reject) => {
      const bytes = body ? Buffer.from(JSON.stringify(body)) : null;
      const call = request(
        {
          socketPath,
          path,
          method: bytes ? "POST" : "GET",
          agent: false,
          headers: {
            Host: "localhost",
            ...(bytes
              ? {
                  "Content-Type": "application/json",
                  "Content-Length": bytes.length,
                }
              : {}),
          },
        },
        (response) => {
          let data = "";
          response.setEncoding("utf8");
          response.on("data", (part) => {
            data += part;
            if (Buffer.byteLength(data) > 65536)
              call.destroy(new Error("Signer response exceeded limit"));
          });
          response.on("error", () =>
            finish(new Error("Signer response failed")),
          );
          response.on("end", () => {
            if (response.statusCode !== 200)
              return finish(new Error("Signer rejected the operation"));
            try {
              finish(null, JSON.parse(data));
            } catch {
              finish(new Error("Signer response invalid"));
            }
          });
        },
      );
      const timer = setTimeout(
        () => call.destroy(new Error("Signer deadline")),
        3000,
      );
      const finish = (error, result) => {
        clearTimeout(timer);
        if (error) reject(error);
        else resolve(result);
      };
      call.once("error", () => finish(new Error("Signer unavailable")));
      call.end(bytes);
    });
  }
  return Object.freeze({
    running: () => child.exitCode === null && child.signalCode === null,
    certificate: async () => {
      const value = await call("/certificate");
      if (
        typeof value?.certificate !== "string" ||
        Buffer.byteLength(value.certificate) > 60000 ||
        !/^[0-9a-f]{64}$/.test(value.keyId)
      )
        throw new Error("Invalid signer certificate");
      return value;
    },
    sign: async (keyId, digest) => {
      const value = await call("/sign", { keyId, digest });
      if (
        typeof value?.signature !== "string" ||
        !/^[A-Za-z0-9_-]{11,96}$/.test(value.signature)
      )
        throw new Error("Invalid signer signature");
      return value;
    },
    close: async () => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGTERM");
        const kill = setTimeout(() => child.kill("SIGKILL"), 5000);
        await exited;
        clearTimeout(kill);
      }
      try {
        const stat = lstatSync(socketPath);
        if (stat.isSocket() && stat.uid === process.geteuid())
          unlinkSync(socketPath);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    },
  });
}
