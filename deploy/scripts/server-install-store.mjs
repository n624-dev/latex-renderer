import { constants } from "node:fs";
import { lstat, open, realpath, rename, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { validateInstallationJournal } from "./server-install-transaction.mjs";

/** The root adapter supplies fixed slots, never a frontend pathname. Secure
 * reads and atomic writes share the same ownership/type/link/size constraints.
 */
export class ServerInstallStore {
  constructor(root, slots, uid = 0) {
    this.root = root;
    this.slots = slots;
    this.uid = uid;
  }
  async parents(path) {
    if (!path.startsWith("/") || resolve(path) !== path)
      throw new Error("Non-canonical installation path");
    for (let parent = dirname(path); ; parent = dirname(parent)) {
      const info = await lstat(parent);
      if (
        !info.isDirectory() ||
        ![0, this.uid].includes(info.uid) ||
        info.mode & 0o022 ||
        (await realpath(parent)) !== parent
      )
        throw new Error("Installation path is not controlled");
      if (parent === "/") break;
    }
  }
  async privateRoot() {
    await this.parents(`${this.root}/journal.json`);
    const info = await lstat(this.root);
    if (info.uid !== this.uid || (info.mode & 0o7777) !== 0o700)
      throw new Error("Installation journal directory must be private");
  }
  slot(name) {
    if (!Object.hasOwn(this.slots, name))
      throw new Error("Unsupported installation file slot");
    return this.slots[name];
  }
  async read(slot) {
    await this.parents(slot.path);
    let handle;
    try {
      handle = await open(
        slot.path,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
    try {
      const info = await handle.stat();
      if (
        !info.isFile() ||
        info.nlink !== 1 ||
        info.uid !== this.uid ||
        info.gid !== slot.gid ||
        (info.mode & 0o7777) !== slot.mode ||
        info.size > slot.maximum
      )
        throw new Error("Unsafe installation file");
      const bytes = Buffer.alloc(slot.maximum + 1);
      let count = 0;
      while (count < bytes.length) {
        const part = await handle.read(
          bytes,
          count,
          bytes.length - count,
          count,
        );
        if (!part.bytesRead) break;
        count += part.bytesRead;
      }
      const after = await handle.stat(),
        entry = await lstat(slot.path);
      if (
        count !== info.size ||
        entry.dev !== info.dev ||
        entry.ino !== info.ino ||
        ["size", "nlink", "uid", "gid", "mode", "mtimeMs", "ctimeMs"].some(
          (key) => info[key] !== after[key],
        )
      )
        throw new Error("Installation file changed while reading");
      return bytes.subarray(0, count).toString("utf8");
    } finally {
      await handle.close();
    }
  }
  async sync(path) {
    const handle = await open(
      path,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
  async write(slot, contents) {
    await this.read(slot); // rejects existing unsafe entries, including symlinks
    if (
      contents !== null &&
      (typeof contents !== "string" ||
        Buffer.byteLength(contents) > slot.maximum)
    )
      throw new Error("Installation file exceeds bounds");
    if (contents === null) {
      await unlink(slot.path).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      });
      await this.sync(dirname(slot.path));
      return;
    }
    const temporary = `${slot.path}.server-setup-tmp`;
    // A killed writer can leave only our exact fixed private temporary slot.
    const stale = await lstat(temporary).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (stale) {
      if (
        !stale.isFile() ||
        stale.nlink !== 1 ||
        stale.uid !== this.uid ||
        stale.gid !== slot.gid ||
        (stale.mode & 0o7777) !== slot.mode ||
        stale.size > slot.maximum
      )
        throw new Error("Unsafe installation temporary entry");
      await unlink(temporary);
    }
    const handle = await open(
      temporary,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      slot.mode,
    );
    try {
      await handle.chown(this.uid, slot.gid);
      await handle.chmod(slot.mode);
      await handle.writeFile(contents);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, slot.path);
    await this.sync(dirname(slot.path));
  }
  journalSlot() {
    return {
      path: `${this.root}/journal.json`,
      mode: 0o600,
      gid: this.uid,
      maximum: 3 * 1024 ** 2,
    };
  }
  async journal() {
    await this.privateRoot();
    const value = await this.read(this.journalSlot());
    if (value === null) return null;
    const journal = validateInstallationJournal(JSON.parse(value));
    for (const entries of [journal.before, journal.after])
      for (const name of Object.keys(entries)) this.slot(name);
    return journal;
  }
  async saveJournal(value) {
    await this.privateRoot();
    validateInstallationJournal(value);
    for (const entries of [value.before, value.after])
      for (const name of Object.keys(entries)) this.slot(name);
    await this.write(this.journalSlot(), JSON.stringify(value));
  }
  async clear() {
    await this.privateRoot();
    await this.write(this.journalSlot(), null);
  }
  async snapshot(candidate) {
    const names =
      candidate.deployment.ingress?.mode === "standalone"
        ? [
            "environment",
            "certificate",
            "privateKey",
            "nginx",
            "oidcSecret",
            ...(Object.hasOwn(this.slots, "updateEnv") ? ["updateEnv"] : []),
          ]
        : [
            "environment",
            "oidcSecret",
            ...(Object.hasOwn(this.slots, "updateEnv") ? ["updateEnv"] : []),
          ];
    return this.snapshotFiles(
      Object.fromEntries(names.map((name) => [name, null])),
    );
  }
  async snapshotFiles(entries) {
    const result = {};
    for (const name of Object.keys(entries))
      result[name] = await this.read(this.slot(name));
    return result;
  }
  async replace(entries) {
    for (const [name, contents] of Object.entries(entries))
      await this.write(this.slot(name), contents);
  }
  async assertCompatible(journal) {
    for (const [name, current] of Object.entries(
      await this.snapshotFiles(journal.after),
    ))
      if (current !== journal.before[name] && current !== journal.after[name])
        throw new Error("Installation file changed outside transaction");
  }
}
