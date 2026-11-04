import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import {
  openSync,
  closeSync,
  fsyncSync,
  writeFileSync,
  mkdirSync,
  lstatSync,
  realpathSync,
  unlinkSync,
  constants,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { generateKeyPairSync } from "node:crypto";
import { createLanHttpsExternalAccountBinding } from "./eab.mjs";
import { profileRecord } from "../../packages/server-setup-core/src/profile-shape.mjs";
import { isMainModule } from "../scripts/is-main-module.mjs";

export function storeLanHttpsEabCredentials(output, input) {
  const model = profileRecord(input, "EAB credentials", ["kid", "hmacKey"]);
  if (typeof model.kid !== "string" || typeof model.hmacKey !== "string")
    throw new Error("EAB input must contain KID and HMAC key");
  const credentials = {
    kid: model.kid.trim(),
    hmacKey: model.hmacKey.trim().replace(/={1,2}$/, ""),
  };
  const publicKey = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  }).publicKey.export({ format: "jwk" });
  createLanHttpsExternalAccountBinding(publicKey, {
    ...credentials,
    newAccountUrl: "https://acme.zerossl.com/v2/DV90/newAccount",
  });
  const path = resolve(output),
    parent = dirname(path);
  const repository = fileURLToPath(new URL("../../", import.meta.url)).replace(
    /\/$/,
    "",
  );
  if (
    path === repository ||
    path.startsWith(repository + "/") ||
    typeof process.geteuid !== "function"
  )
    throw new Error(
      "Store CA credentials outside the repository in a private POSIX directory",
    );
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  const stat = lstatSync(parent);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    stat.uid !== process.geteuid() ||
    (stat.mode & 0o7777) !== 0o700 ||
    realpathSync(parent) !== parent
  )
    throw new Error(
      "EAB directory must be canonical, owned by the current user and mode 0700",
    );
  let fd,
    created = false,
    success = false;
  try {
    fd = openSync(
      path,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
    created = true;
    writeFileSync(fd, JSON.stringify(credentials) + "\n");
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    const directory = openSync(
      parent,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    try {
      fsyncSync(directory);
    } finally {
      closeSync(directory);
    }
    success = true;
    return Object.freeze({
      path,
      kidCharacters: credentials.kid.length,
      hmacCharacters: credentials.hmacKey.length,
    });
  } finally {
    if (fd !== undefined) closeSync(fd);
    if (created && !success) unlinkSync(path);
  }
}

async function main() {
  const [flag, output, ...extra] = process.argv.slice(2);
  if (
    flag !== "--output" ||
    !output ||
    extra.length ||
    !process.stdin.isTTY ||
    !process.stderr.isTTY
  )
    throw new Error(
      "usage: prepare-eab.mjs --output PRIVATE_FILE (interactive TTY required; no secret command arguments)",
    );
  const hidden = new Writable({
    write(_chunk, _encoding, done) {
      done();
    },
  });
  const lines = createInterface({
    input: process.stdin,
    output: hidden,
    terminal: true,
  });
  const iterator = lines[Symbol.asyncIterator]();
  lines.on("SIGINT", () => lines.close());
  async function read(label) {
    process.stderr.write(label);
    const line = await iterator.next();
    process.stderr.write("\n");
    if (line.done || line.value.length > 1024)
      throw new Error("EAB input was cancelled or too long");
    return line.value;
  }
  try {
    const kid = await read("EAB KID（非表示、貼付け後Enter）: ");
    const hmacKey = await read("EAB HMACキー（非表示、貼付け後Enter）: ");
    const result = storeLanHttpsEabCredentials(output, { kid, hmacKey });
    process.stderr.write(
      `保存しました。KID ${result.kidCharacters}文字、HMAC ${result.hmacCharacters}文字。形式検査のみで、実CAへの認証・発行はまだ行っていません。\n`,
    );
  } finally {
    lines.close();
    hidden.end();
  }
}

if (isMainModule(import.meta.url)) {
  main().catch(() => {
    process.stderr.write(
      "EAB保存に失敗しました。形式・TTY・保存先の権限・既存ファイルを確認してください。秘密情報は表示しません。\n",
    );
    process.exitCode = 1;
  });
}
