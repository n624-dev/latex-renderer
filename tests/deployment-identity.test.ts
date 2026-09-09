import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";

// Exercise the actual small resolver without importing/executing the privileged
// helper entry point. Only OS configuration reads and id lookups are replaced.
const helper = readFileSync("deploy/scripts/update-manager-helper.mjs", "utf8");
const resolver = helper.slice(
  helper.indexOf("async function deploymentIdentity()"),
  helper.indexOf("export async function buildBootstrapRelease"),
);
async function resolveIdentity(
  env: Record<string, string>,
  configuration?: string,
  id = "1001",
  readError = "ENOENT",
) {
  const users: string[] = [];
  const identity = await (runInNewContext(`${resolver}; deploymentIdentity()`, {
    process: { env },
    readFile: () => {
      if (configuration === undefined)
        return Promise.reject(
          Object.assign(new Error(readError), { code: readError }),
        );
      return Promise.resolve(configuration);
    },
    runCapture: (program: string, args: string[]) => {
      expect(program).toBe("id");
      users.push(args[1] ?? "");
      return Promise.resolve(`${id}\n`);
    },
  }) as Promise<{ deployUser: string; uid: string; gid: string }>);
  return { identity, users };
}

it("uses the actual sudo account on first install, not ubuntu", async () => {
  const { identity, users } = await resolveIdentity({ SUDO_USER: "runner" });
  expect(identity).toEqual({ deployUser: "runner", uid: "1001", gid: "1001" });
  expect(users).toEqual(["runner", "runner"]);
});
it("keeps explicit and persisted account selection ahead of the sudo caller", async () => {
  expect(
    (
      await resolveIdentity({
        UPDATE_DEPLOY_USER: "deployer",
        SUDO_USER: "runner",
      })
    ).identity.deployUser,
  ).toBe("deployer");
  expect(
    (
      await resolveIdentity(
        { SUDO_USER: "runner" },
        "UPDATE_DEPLOY_USER=deployer\n",
      )
    ).identity.deployUser,
  ).toBe("deployer");
});
it("retains the existing fallback for installations without sudo context", async () => {
  expect((await resolveIdentity({})).identity.deployUser).toBe("ubuntu");
});
it.each(["root", "runner;command", "../runner", "", "a".repeat(33)])(
  "rejects unsafe sudo identities (%s)",
  async (user) => {
    await expect(resolveIdentity({ SUDO_USER: user })).rejects.toThrow(
      "non-root account",
    );
  },
);
it("fails closed on unreadable configuration and UID zero", async () => {
  await expect(
    resolveIdentity({ SUDO_USER: "runner" }, undefined, "1001", "EACCES"),
  ).rejects.toThrow("EACCES");
  await expect(
    resolveIdentity({ SUDO_USER: "runner" }, undefined, "0"),
  ).rejects.toThrow("identity is invalid");
});
