import { createRequire } from "node:module";
import { expect, it, vi } from "vitest";
import { chooseAdminInvocation } from "../apps/admin-cli/src/menu.js";

type MenuCommand = Parameters<typeof chooseAdminInvocation>[0];
const requireAdmin = createRequire(
  new URL("../apps/admin-cli/package.json", import.meta.url),
);
const { Command } = requireAdmin("commander") as {
  Command: new () => MenuCommand;
};

function terminal(answers: string[]) {
  return {
    write: vi.fn(),
    ask: vi.fn(() => {
      const value = answers.shift();
      if (value === undefined) throw new Error("Unexpected terminal prompt");
      return Promise.resolve(value);
    }),
  };
}

it("keeps secrets out of command arguments and requires explicit confirmation", async () => {
  const program = new Command();
  const run = vi.fn();
  program
    .command("auth")
    .command("login")
    .requiredOption("--api-key-stdin")
    .action(run);
  const cancelled = terminal(["1", "1", ""]);
  expect(
    await chooseAdminInvocation(program, cancelled, false),
  ).toBeUndefined();
  expect(cancelled.ask).toHaveBeenCalledTimes(3);
  expect(run).not.toHaveBeenCalled();

  const accepted = terminal(["1", "1", "yes", "fixture-secret"]);
  const invocation = await chooseAdminInvocation(program, accepted, false);
  expect(invocation).toEqual({
    args: ["auth", "login", "--api-key-stdin"],
    secret: "fixture-secret",
  });
  expect(accepted.ask).toHaveBeenLastCalledWith(expect.any(String), true);
  if (invocation === undefined) throw new Error("Expected a selected operation");
  await program.parseAsync(invocation.args, { from: "user" });
  expect(run).toHaveBeenCalledTimes(1);
});

it("passes variadic fields, literal arguments, and confirmed changes to Commander", async () => {
  const program = new Command();
  const run = vi.fn();
  program
    .command("api-keys")
    .command("create")
    .argument("<name>")
    .requiredOption("--scope <scope...>")
    .requiredOption("--yes")
    .action(run);
  const io = terminal([
    "1",
    "1",
    "--literal-name",
    "render:create render:read:own",
    "y",
  ]);
  const invocation = await chooseAdminInvocation(program, io, true);
  if (invocation === undefined) throw new Error("Expected a selected operation");
  await program.parseAsync(invocation.args, { from: "user" });
  expect(run).toHaveBeenCalledWith(
    "--literal-name",
    {
      scope: ["render:create", "render:read:own"],
      yes: true,
    },
    expect.anything(),
  );
});
