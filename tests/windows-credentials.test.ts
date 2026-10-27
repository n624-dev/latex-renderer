import { spawnSync } from "node:child_process";
import { afterEach, expect, it, vi } from "vitest";
import { runWindowsCredential } from "../packages/setup-core/src/windows-credential.js";

vi.mock("node:child_process", () => ({ spawnSync: vi.fn() }));
afterEach(() => vi.resetAllMocks());
const secret = `lrk_${"a".repeat(32)}_${"B".repeat(43)}`;
function result(status: number | null) {
  return {
    pid: 1,
    output: [],
    status,
    signal: null,
    stdout: secret,
    stderr: secret,
  };
}

it("isolates inherited module paths without mutating the caller or exposing stdin", () => {
  vi.mocked(spawnSync).mockReturnValue(result(0));
  const env = {
    PSModulePath: "PS7 modules",
    pSmOdUlEpAtH: "custom modules",
    OTHER: "keep",
  };
  runWindowsCredential("save", "C:\\fixture\\credential.bin", env, secret);
  const call = vi.mocked(spawnSync).mock.calls[0];
  if (call === undefined)
    throw new Error("PowerShell invocation was not captured");
  const [command, args, options] = call;
  expect(command).toBe("powershell.exe");
  expect(args).toContain("-NoProfile");
  expect(args).toContain("-NonInteractive");
  expect(JSON.stringify(args)).not.toContain(secret);
  expect(options).toMatchObject({
    input: secret,
    timeout: 15_000,
    maxBuffer: 16_384,
    windowsHide: true,
    env: { OTHER: "keep", LR_CREDENTIAL_PATH: "C:\\fixture\\credential.bin" },
  });
  expect(
    Object.keys(options?.env ?? {}).some(
      (key) => key.toLowerCase() === "psmodulepath",
    ),
  ).toBe(false);
  expect(env).toEqual({
    PSModulePath: "PS7 modules",
    pSmOdUlEpAtH: "custom modules",
    OTHER: "keep",
  });
});

it.each(["load", "probe"] as const)(
  "keeps %s compatible with the same DPAPI format",
  (operation) => {
    vi.mocked(spawnSync).mockReturnValue(result(0));
    expect(runWindowsCredential(operation, "credential.bin", {})).toBe(
      operation === "load" ? secret : "",
    );
    const call = vi.mocked(spawnSync).mock.calls[0];
    if (call === undefined)
      throw new Error("PowerShell invocation was not captured");
    const args = call[1];
    expect(args?.at(-1)).toContain(
      "$PSHOME,'Modules','Microsoft.PowerShell.Security'",
    );
    expect(args?.at(-1)).toContain(
      "Microsoft.PowerShell.Security\\ConvertTo-SecureString",
    );
    expect(args?.at(-1)).toContain("ZeroFreeBSTR");
    if (operation === "probe")
      expect(args?.at(-1)).not.toContain("[Console]::Out.Write");
  },
);

it.each([
  [20, "CREDENTIAL_NOT_FOUND"],
  [21, "CREDENTIAL_RUNTIME_FAILED"],
  [22, "CREDENTIAL_ACCESS_FAILED"],
  [23, "CREDENTIAL_DECRYPT_FAILED"],
  [24, "CREDENTIAL_STORE_FAILED"],
  [1, "CREDENTIAL_RUNTIME_FAILED"],
  [null, "CREDENTIAL_RUNTIME_FAILED"],
] as const)(
  "reports stage %s without exposing PowerShell output",
  (status, code) => {
    vi.mocked(spawnSync).mockReturnValue(result(status));
    try {
      runWindowsCredential("load", "credential.bin", {});
      expect.fail("Expected a credential diagnostic");
    } catch (error) {
      expect(error).toMatchObject({ code });
      expect(String(error)).not.toContain(secret);
    }
  },
);

it("does not include launch or timeout error text in diagnostics", () => {
  vi.mocked(spawnSync).mockReturnValue({
    ...result(null),
    error: new Error(secret),
  });
  expect(() => runWindowsCredential("probe", "credential.bin", {})).toThrow(
    "Windows PowerShell could not initialize",
  );
  expect(() => runWindowsCredential("probe", "credential.bin", {})).not.toThrow(
    secret,
  );
});
