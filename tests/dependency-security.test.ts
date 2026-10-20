import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

function run(source: string) {
  execFileSync(process.execPath, ["--input-type=module", "-e", source], {
    timeout: 15_000,
    stdio: "pipe",
  });
}

const forgeSetup = `
  import assert from "node:assert/strict";
  import { createRequire } from "node:module";
  import { generateKeyPairSync, privateEncrypt, sign, verify, constants } from "node:crypto";
  const root = createRequire(process.cwd() + "/package.json");
  const mcpb = createRequire(root.resolve("@anthropic-ai/mcpb"));
  // Resolve through the real signing dependency, not a test-only direct copy.
  const forge = mcpb("node-forge");
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 1024, publicExponent: 3
  });
  const pem = publicKey.export({ type: "spki", format: "pem" });
  const key = forge.pki.publicKeyFromPem(pem);
  const message = Buffer.from("MCPB dependency regression fixture");
  const digest = forge.md.sha256.create().update(message.toString()).digest().getBytes();
  const a = forge.asn1;
  const item = (type, value, constructed = false) =>
    a.create(a.Class.UNIVERSAL, type, constructed, value);
  const oid = () => item(a.Type.OID, a.oidToDer(forge.oids.sha256).getBytes());
  const nil = () => item(a.Type.NULL, "");
  const extra = () => item(a.Type.OCTETSTRING, "unconsumed garbage");
  function signature(parameters, outerExtra = []) {
    const info = item(a.Type.SEQUENCE, [
      item(a.Type.SEQUENCE, parameters, true),
      item(a.Type.OCTETSTRING, digest), ...outerExtra
    ], true);
    const der = Buffer.from(a.toDer(info).getBytes(), "binary");
    // Correct RSA/PKCS#1 padding isolates the vulnerable ASN.1 parser. A raw
    // private operation constructs malformed encodings no normal signer emits.
    const block = Buffer.concat([Buffer.from([0, 1]),
      Buffer.alloc(128 - der.length - 3, 255), Buffer.from([0]), der]);
    return privateEncrypt({ key: privateKey, padding: constants.RSA_NO_PADDING },
      block).toString("binary");
  }
`;

it("pins the RSA parser patch and removes every locked sprintf-js copy", () => {
  const workspace = readFileSync("pnpm-workspace.yaml", "utf8");
  const lock = readFileSync("pnpm-lock.yaml", "utf8");
  expect(workspace).toContain(
    "node-forge@1.4.0: patches/node-forge@1.4.0.patch",
  );
  expect(lock).toMatch(/node-forge@1\.4\.0\(patch_hash=[a-f0-9]+\):/);
  expect(lock).not.toMatch(/^ {2}node-forge@1\.4\.0: \{\}/m);
  expect(lock).not.toMatch(/^ {2}sprintf-js@/m);
  expect(readFileSync(".gitattributes", "utf8")).toContain(
    "patches/*.patch text eol=lf",
  );
});

it("rejects nested RSA DigestAlgorithm garbage, including alternate parameter forms", () => {
  run(`${forgeSetup}
    for (const parameters of [
      [oid(), nil(), extra()],
      [oid(), extra()],
      [oid(), nil(), nil()],
      [oid(), nil(), oid()],
      [oid(), item(a.Type.NULL, "garbage inside NULL")],
      [oid(), item(a.Type.SEQUENCE, [], true)]
    ]) {
      assert.throws(() => key.verify(digest, signature(parameters)), /DigestInfo/);
    }
    assert.throws(() => key.verify(digest, signature([oid(), nil()], [extra()])),
      /DigestInfo/);
  `);
});

it("preserves normal RSA signing, optional SHA parameters, digest and padding checks", () => {
  run(`${forgeSetup}
    for (const parameters of [[oid(), nil()], [oid()]]) {
      const valid = signature(parameters);
      assert.equal(key.verify(digest, valid), true);
      assert.equal(key.verify("wrong digest", valid), false);
    }
    for (const algorithm of ["sha1", "sha256", "sha384", "sha512"]) {
      const native = sign(algorithm, message, privateKey);
      const hash = forge.md[algorithm].create().update(message.toString());
      assert.equal(key.verify(hash.digest().getBytes(), native.toString("binary")), true);
      const signer = forge.pki.privateKeyFromPem(privateKey.export({
        type: "pkcs8", format: "pem"
      }));
      const signed = Buffer.from(signer.sign(
        forge.md[algorithm].create().update(message.toString())), "binary");
      assert.equal(verify(algorithm, message, publicKey, signed), true);
    }
    assert.throws(() => key.verify(digest, "\\0".repeat(128)));
    const pss = forge.pss.create({ md: forge.md.sha256.create(),
      mgf: forge.mgf.mgf1.create(forge.md.sha256.create()), saltLength: 32 });
    const signedPss = sign("sha256", message, { key: privateKey,
      padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 });
    assert.equal(key.verify(digest, signedPss.toString("binary"), pss), true);
  `);
});

it("keeps the real MCPB signer interoperable with independent OpenSSL CMS verification", () => {
  run(`${forgeSetup}
    const { execFileSync } = await import("node:child_process");
    const { mkdtempSync, writeFileSync, readFileSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { dirname, join } = await import("node:path");
    const { pathToFileURL } = await import("node:url");
    const { signMcpbFile } = await import(pathToFileURL(join(
      dirname(root.resolve("@anthropic-ai/mcpb")), "node/sign.js"
    )).href);
    const directory = mkdtempSync(join(tmpdir(), "mcpb-signature-regression-"));
    try {
      const certificate = forge.pki.createCertificate();
      certificate.publicKey = key;
      certificate.serialNumber = "01";
      certificate.validity.notBefore = new Date(Date.now() - 60_000);
      certificate.validity.notAfter = new Date(Date.now() + 86_400_000);
      const subject = [{ name: "commonName", value: "MCPB regression fixture" }];
      certificate.setSubject(subject);
      certificate.setIssuer(subject);
      certificate.sign(forge.pki.privateKeyFromPem(privateKey.export({
        type: "pkcs8", format: "pem"
      })), forge.md.sha256.create());
      const archive = join(directory, "fixture.mcpb");
      const certPath = join(directory, "certificate.pem");
      const keyPath = join(directory, "key.pem");
      writeFileSync(archive, message);
      writeFileSync(certPath, forge.pki.certificateToPem(certificate));
      writeFileSync(keyPath, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
      signMcpbFile(archive, certPath, keyPath);
      const signed = readFileSync(archive);
      const header = Buffer.from("MCPB_SIG_V1");
      assert.deepEqual(signed.subarray(0, message.length), message);
      assert.deepEqual(signed.subarray(message.length, message.length + header.length), header);
      const lengthOffset = message.length + header.length;
      const start = lengthOffset + 4;
      const end = start + signed.readUInt32LE(lengthOffset);
      assert.equal(signed.subarray(end).toString(), "MCPB_SIG_END");
      const cms = join(directory, "signature.der");
      const content = join(directory, "content");
      writeFileSync(cms, signed.subarray(start, end));
      writeFileSync(content, message);
      const args = ["cms", "-verify", "-binary", "-inform", "DER", "-in", cms,
        "-content", content, "-noverify", "-out", join(directory, "verified")];
      execFileSync("openssl", args, { timeout: 5000, stdio: "pipe" });
      assert.deepEqual(readFileSync(join(directory, "verified")), message);
      writeFileSync(content, "modified payload");
      assert.throws(() => execFileSync("openssl", args, { timeout: 5000, stdio: "pipe" }));
    } finally { rmSync(directory, { recursive: true, force: true }); }
  `);
});

it("preserves js-yaml CLI compatibility without sprintf-js and treats formats as document text", () => {
  run(`
    import assert from "node:assert/strict";
    import { execFileSync } from "node:child_process";
    import { createRequire } from "node:module";
    import { dirname, join } from "node:path";
    const web = createRequire(process.cwd() + "/apps/admin-web/package.json");
    const matter = web("gray-matter");
    const matterRequire = createRequire(web.resolve("gray-matter"));
    const yamlRequire = createRequire(matterRequire.resolve("js-yaml"));
    const parser = yamlRequire("argparse/package.json");
    assert.equal(parser.version, "3.0.3");
    assert.equal(parser.dependencies?.["sprintf-js"], undefined);
    const cli = join(dirname(matterRequire.resolve("js-yaml/package.json")), "bin/js-yaml.js");
    const run = (args, input) => execFileSync(process.execPath, [cli, ...args], {
      input, encoding: "utf8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"]
    });
    assert.match(run(["--help"]), /--compact/);
    assert.equal(run(["--version"]).trim(), "3.15.2");
    assert.deepEqual(JSON.parse(run([], "title: 日本語\\ncount: 2\\n")), {
      title: "日本語", count: 2
    });
    assert.match(run([], '{"title":"Example","count":2}'), /count: 2/);
    for (const flag of ["--compact", "--trace", "--to-json", "-c", "-t", "-j"]) {
      assert.deepEqual(JSON.parse(run([flag], "count: 2\\n")), { count: 2 });
    }
    assert.throws(() => run(["--compact"], "invalid: [\\n"),
      error => error.status === 1 && !/TypeError|Cannot find module/.test(error.stderr));
    for (const value of ["%.101f", "%.101e", "%.101g", "%.0g", "%.99999999999999999999f"]) {
      const source = "---\\ntitle: '" + value + "'\\n---\\nBody";
      assert.equal(matter(source).data.title, value);
      assert.equal(JSON.parse(run([], "title: '" + value + "'\\n")).title, value);
    }
  `);
});
