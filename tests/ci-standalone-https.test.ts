import { beforeEach, expect, it, vi } from "vitest";
import { readFile, writeFile } from "node:fs/promises";
import { activateStandaloneHttps } from "../deploy/ci/standalone-https.mjs";

vi.mock("node:fs/promises", () => ({ readFile: vi.fn(), writeFile: vi.fn() }));
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(readFile).mockResolvedValue("127.0.0.1 localhost\n");
});
it("activates the prepared TLS fixture with one scoped hosts entry", async () => {
  const calls: string[] = [];
  vi.mocked(writeFile).mockImplementation(() => {
    calls.push("hosts");
    return Promise.resolve();
  });
  await activateStandaloneHttps((command, args) =>
    calls.push([command, ...args].join(" ")),
  );
  expect(calls).toEqual([
    "/usr/sbin/update-ca-certificates",
    "hosts",
    "/usr/sbin/nginx -t",
    "/usr/bin/systemctl start nginx",
  ]);
  expect(writeFile).toHaveBeenCalledWith(
    "/etc/hosts",
    "127.0.0.1 localhost\n\n127.0.0.1 latex-renderer-ci.test\n",
  );
});
it("does not duplicate an existing alias and ignores names in comments", async () => {
  vi.mocked(readFile).mockResolvedValue(
    "127.0.0.1 localhost latex-renderer-ci.test # fixture\n",
  );
  await activateStandaloneHttps(() => {});
  expect(writeFile).not.toHaveBeenCalled();
  vi.mocked(readFile).mockResolvedValue(
    "127.0.0.1 localhost # latex-renderer-ci.test\n",
  );
  await activateStandaloneHttps(() => {});
  expect(writeFile).toHaveBeenCalledOnce();
});
it("does not start the fixture after a hosts write or configuration validation failure", async () => {
  const calls: string[] = [];
  vi.mocked(writeFile).mockRejectedValueOnce(new Error("ENOSPC"));
  await expect(
    activateStandaloneHttps((_command, args) => calls.push(args.join(" "))),
  ).rejects.toThrow("ENOSPC");
  expect(calls).not.toContain("start nginx");
  await expect(
    activateStandaloneHttps((command, args) => {
      if (command === "/usr/sbin/nginx") throw new Error("invalid config");
      calls.push(args.join(" "));
    }),
  ).rejects.toThrow("invalid config");
  expect(calls).not.toContain("start nginx");
});
