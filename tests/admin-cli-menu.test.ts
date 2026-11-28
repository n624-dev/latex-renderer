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

it("passes quoted and escaped variadic positional values to Commander", async () => {
  const program = new Command();
  const run = vi.fn();
  program.command("read").argument("<paths...>").action(run);
  const io = terminal(["1", String.raw`a "b c" 'd e' f\ g`, "y"]);

  const invocation = await chooseAdminInvocation(program, io, false);
  if (invocation === undefined)
    throw new Error("Expected a selected operation");
  await program.parseAsync(invocation.args, { from: "user" });
  expect(run).toHaveBeenCalledWith(
    ["a", "b c", "d e", "f g"],
    {},
    expect.anything(),
  );
});

it("passes quoted and escaped variadic option values to Commander", async () => {
  const program = new Command();
  const run = vi.fn();
  program.command("read").requiredOption("--file <path...>").action(run);
  const io = terminal([
    "1",
    String.raw`dir/"path with spaces.pdf" "a\"b" 'c\d' tail\ `,
    "y",
  ]);

  const invocation = await chooseAdminInvocation(program, io, false);
  if (invocation === undefined)
    throw new Error("Expected a selected operation");
  await program.parseAsync(invocation.args, { from: "user" });
  expect(run).toHaveBeenCalledWith(
    { file: ["dir/path with spaces.pdf", 'a"b', "c\\d", "tail "] },
    expect.anything(),
  );
});

it.each([
  {
    input: '"unclosed',
    japanese: false,
    message: "Unclosed quote or trailing backslash.\n",
  },
  {
    input: "trailing\\",
    japanese: true,
    message:
      "引用符が閉じていないか、末尾のバックスラッシュの後に文字がありません。\n",
  },
  { input: '""', japanese: false, message: "Enter a value.\n" },
])(
  "asks again after invalid list input $input",
  async ({ input, japanese, message }) => {
    const program = new Command();
    const run = vi.fn();
    program.command("read").requiredOption("--file <path...>").action(run);
    const io = terminal(["1", input, '"valid path.pdf"', "y"]);

    const invocation = await chooseAdminInvocation(program, io, japanese);
    expect(io.write).toHaveBeenCalledWith(message);
    expect(io.ask).toHaveBeenNthCalledWith(2, "--file <path...>: ");
    expect(io.ask).toHaveBeenNthCalledWith(3, "--file <path...>: ");
    if (invocation === undefined)
      throw new Error("Expected a selected operation");
    await program.parseAsync(invocation.args, { from: "user" });
    expect(run).toHaveBeenCalledWith(
      { file: ["valid path.pdf"] },
      expect.anything(),
    );
  },
);

it("rejects a variadic option value that starts with a hyphen after tokenization", async () => {
  const program = new Command();
  program.command("read").requiredOption("--file <path...>");
  const io = terminal(["1", 'valid.pdf "-invalid path.pdf"']);

  await expect(chooseAdminInvocation(program, io, false)).rejects.toThrow(
    "List values must not start with a hyphen",
  );
});

it("passes a non-variadic option value verbatim to Commander", async () => {
  const program = new Command();
  const run = vi.fn();
  program.command("read").requiredOption("--file <path>").action(run);
  const value = String.raw`  dir/"path with spaces.pdf"\ `;
  const io = terminal(["1", value, "y"]);

  const invocation = await chooseAdminInvocation(program, io, false);
  if (invocation === undefined)
    throw new Error("Expected a selected operation");
  await program.parseAsync(invocation.args, { from: "user" });
  expect(run).toHaveBeenCalledWith({ file: value }, expect.anything());
});

it.each(["=value", "-value", "--", "--json"])(
  "passes %s as a short-only option value",
  async (value) => {
    const program = new Command().option("--json");
    const run = vi.fn();
    program
      .command("read")
      .requiredOption("-x <required>")
      .requiredOption("-o [optional]")
      .action(run);
    const io = terminal(["1", value, value, "y"]);

    const invocation = await chooseAdminInvocation(program, io, false);
    if (invocation === undefined)
      throw new Error("Expected a selected operation");
    expect(invocation.args).toEqual(["read", `-x${value}`, `-o${value}`]);
    await program.parseAsync(invocation.args, { from: "user" });
    expect(run).toHaveBeenCalledWith({ x: value, o: value }, expect.anything());
    expect(program.opts()).toEqual({});
  },
);
