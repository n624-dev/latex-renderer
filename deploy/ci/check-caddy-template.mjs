// Adapt and validate the shipped configuration without starting a listener or
// requesting a certificate. The caller supplies the Caddy version to exercise.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { URL } from "node:url";

if (process.argv.length !== 3) throw new Error("Expected a Caddy executable");
const binary = resolve(process.argv[2]);
const work = await mkdtemp(join(tmpdir(), "caddy-template-"));
const run = (program, args) =>
  execFileSync(program, args, {
    cwd: work,
    env: { ...process.env, XDG_DATA_HOME: work, XDG_CONFIG_HOME: work },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 30000,
  });
try {
  run("openssl", [
    "req",
    "-x509",
    "-newkey",
    "ec",
    "-pkeyopt",
    "ec_paramgen_curve:P-256",
    "-nodes",
    "-days",
    "1",
    "-subj",
    "/CN=localhost",
    "-addext",
    "subjectAltName=DNS:localhost",
    "-keyout",
    "key.pem",
    "-out",
    "cert.pem",
  ]);
  const template = await readFile(
    new URL("../reverse-proxy/Caddyfile.example", import.meta.url),
    "utf8",
  );
  await writeFile(
    join(work, "Caddyfile"),
    "{\n  admin off\n}\n" +
      template
        .replaceAll("latex.example.com", "localhost")
        .replace("localhost {", "localhost {\n  tls cert.pem key.pem"),
  );
  const config = JSON.parse(
    run(binary, ["adapt", "--config", "Caddyfile", "--adapter", "caddyfile"]),
  );
  const encoded = JSON.stringify(config);
  for (const upstream of [3100, 3101, 3102, 3104, 3105])
    assert(encoded.includes(`127.0.0.1:${upstream}`));
  assert(encoded.includes('"max_size":220000000'));
  assert(encoded.includes('"CF-Access-Jwt-Assertion"'));
  assert(encoded.includes('"X-Latex-Renderer-Client-Ip"'));
  run(binary, ["validate", "--config", "Caddyfile", "--adapter", "caddyfile"]);
  console.log(
    JSON.stringify({
      event: "ci.caddy_template.passed",
      version: run(binary, ["version"]).trim(),
    }),
  );
} finally {
  await rm(work, { recursive: true, force: true });
}
