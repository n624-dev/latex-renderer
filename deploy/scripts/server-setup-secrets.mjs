import { constants } from "node:fs";
import { lstat, open, realpath, link, unlink, readdir } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";

const slots = Object.freeze({
  "api-key-pepper": Object.freeze({ mode: 0o400, rendererGroup: false }),
  "auth-password-pepper": Object.freeze({ mode: 0o440, rendererGroup: true }),
});

/** Prepared-host secret primitive; importing or constructing does not generate
 * keys. Existing invalid keys cause failure, never repair/rotation. The root
 * adapter owns the shared mutation lock and chooses the fixed secret directory.
 * This class is not reachable from an arbitrary browser file-path operation.
 */
export class ServerSetupSecrets {
  constructor(root, rendererGid, uid = 0, rootGid = 0) {
    if (
      typeof root !== "string" ||
      !root.startsWith("/") ||
      resolve(root) !== root ||
      root === "/" ||
      ![rendererGid, uid, rootGid].every(
        (id) => Number.isSafeInteger(id) && id >= 0,
      )
    )
      throw new Error("Invalid prepared secret store");
    this.root = root;
    this.rendererGid = rendererGid;
    this.uid = uid;
    this.rootGid = rootGid;
  }
  slot(name) {
    if (!Object.hasOwn(slots, name))
      throw new Error("Unsupported generated secret slot");
    return {
      ...slots[name],
      gid: slots[name].rendererGroup ? this.rendererGid : this.rootGid,
      path: `${this.root}/${name}`,
    };
  }
  async directory() {
    const info = await lstat(this.root);
    if (
      !info.isDirectory() ||
      info.uid !== this.uid ||
      (info.mode & 0o7777) !== 0o700 ||
      (await realpath(this.root)) !== this.root
    )
      throw new Error(
        "Secret directory must already be prepared, canonical and private",
      );
  }
  async read(name) {
    await this.directory();
    const slot = this.slot(name);
    const handle = await open(
      slot.path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    let value;
    try {
      const info = await handle.stat();
      if (
        !info.isFile() ||
        info.nlink !== 1 ||
        info.uid !== this.uid ||
        info.gid !== slot.gid ||
        (info.mode & 0o7777) !== slot.mode ||
        info.size !== 32
      )
        throw new Error(
          "Existing secret is invalid; never rotate it automatically",
        );
      value = Buffer.alloc(33);
      let length = 0;
      while (length < value.length) {
        const result = await handle.read(
          value,
          length,
          value.length - length,
          length,
        );
        if (result.bytesRead === 0) break;
        length += result.bytesRead;
      }
      const after = await handle.stat(),
        entry = await lstat(slot.path);
      if (
        length !== 32 ||
        !entry.isFile() ||
        entry.dev !== info.dev ||
        entry.ino !== info.ino ||
        after.nlink !== 1 ||
        after.size !== info.size ||
        after.mode !== info.mode ||
        after.uid !== info.uid ||
        after.gid !== info.gid ||
        after.mtimeMs !== info.mtimeMs ||
        after.ctimeMs !== info.ctimeMs
      )
        throw new Error("Secret changed while reading");
      return Buffer.from(value.subarray(0, 32));
    } finally {
      value?.fill(0);
      await handle.close();
    }
  }
  /** Call under the shared host mutation lock before provisioning. Recovers
   * only this store's bounded temporary names/inodes; no age/PID guess and no
   * recursive deletion. Never repairs an unrelated hardlinked secret.
   */
  async recover() {
    await this.directory();
    const names = (await readdir(this.root)).filter((name) =>
      /^\.setup-secret-[a-f0-9]{48}$/.test(name),
    );
    if (names.length > 128)
      throw new Error("Secret recovery exceeds safety limit");
    const removable = [];
    for (const name of names) {
      const path = `${this.root}/${name}`,
        info = await lstat(path);
      if (
        !info.isFile() ||
        info.uid !== this.uid ||
        ![this.rootGid, this.rendererGid].includes(info.gid) ||
        ![0o600, 0o400, 0o440].includes(info.mode & 0o7777) ||
        info.size > 32 ||
        ![1, 2].includes(info.nlink)
      )
        throw new Error("Unexpected secret recovery entry");
      if (info.nlink === 2) {
        let matches = 0;
        for (const slotName of Object.keys(slots)) {
          const slot = this.slot(slotName);
          const entry = await lstat(slot.path).catch((error) => {
            if (error.code === "ENOENT") return null;
            throw error;
          });
          if (
            entry?.isFile() &&
            entry.dev === info.dev &&
            entry.ino === info.ino &&
            entry.size === 32 &&
            entry.nlink === 2 &&
            (entry.mode & 0o7777) === slot.mode &&
            entry.uid === this.uid &&
            entry.gid === slot.gid
          )
            matches++;
        }
        if (matches !== 1)
          throw new Error("Unexpected secret recovery sharing");
      }
      removable.push({ path, info });
    }
    for (const { path, info } of removable) {
      const entry = await lstat(path);
      if (
        !entry.isFile() ||
        entry.dev !== info.dev ||
        entry.ino !== info.ino ||
        entry.nlink !== info.nlink ||
        entry.mode !== info.mode ||
        entry.uid !== info.uid ||
        entry.gid !== info.gid
      )
        throw new Error("Secret recovery entry changed");
      await unlink(path);
    }
    const directory = await open(
      this.root,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
    return { removed: removable.length };
  }
  async ensure(name) {
    await this.directory();
    const slot = this.slot(name);
    // lstat distinguishes absence from permission, dangling symlink and FIFO.
    const existing = await lstat(slot.path).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (existing !== null) {
      const value = await this.read(name);
      value.fill(0);
      return { slot: name, status: "preserved" };
    }
    const temporary = `${this.root}/.setup-secret-${randomBytes(24).toString("hex")}`;
    let linked = false;
    const value = randomBytes(32);
    const handle = await open(
      temporary,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
    try {
      await handle.writeFile(value);
      await handle.chown(this.uid, slot.gid);
      await handle.chmod(slot.mode);
      await handle.sync();
      // Unlike rename, this cannot overwrite a key created by another actor.
      await link(temporary, slot.path);
      linked = true;
    } catch (error) {
      if (error.code !== "EEXIST")
        throw new Error("Secret generation failed; inspect private state", {
          cause: error,
        });
    } finally {
      value.fill(0);
      await handle.close();
      await unlink(temporary);
    }
    const directory = await open(
      this.root,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
    const checked = await this.read(name);
    checked.fill(0);
    return { slot: name, status: linked ? "created" : "preserved" };
  }
}
