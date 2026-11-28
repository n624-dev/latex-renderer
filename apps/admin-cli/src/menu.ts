import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import type { Command } from "commander";
import { AppError } from "@latex-renderer/shared";
import { terminalDisplayLocale } from "@latex-renderer/shared/locale";

type MenuTerminal = {
  write: (text: string) => void;
  ask: (prompt: string, secret?: boolean) => Promise<string>;
};

export type AdminMenuInvocation = { args: string[]; secret?: string };

function tokenizeList(value: string): string[] | undefined {
  const items: string[] = [];
  let item: string | undefined;
  let quote: string | undefined;
  let escaped = false;
  for (const character of value) {
    if (escaped) {
      item = (item ?? "") + character;
      escaped = false;
    } else if (character === "\\" && quote !== "'") {
      escaped = true;
    } else if (character === quote) {
      quote = undefined;
    } else if (
      quote === undefined &&
      (character === '"' || character === "'")
    ) {
      quote = character;
      item ??= "";
    } else if (quote === undefined && /\s/.test(character)) {
      if (item !== undefined) items.push(item);
      item = undefined;
    } else {
      item = (item ?? "") + character;
    }
  }
  if (quote !== undefined || escaped) return undefined;
  if (item !== undefined) items.push(item);
  return items;
}

export async function openAdminMenu(
  program: Command,
): Promise<AdminMenuInvocation | undefined> {
  let hidden = false;
  const output = new Writable({
    write(chunk: Buffer, _encoding, done) {
      if (hidden) done();
      else process.stdout.write(chunk, done);
    },
  });
  const controller = new AbortController();
  const line = createInterface({
    input: process.stdin,
    output,
    terminal: true,
    historySize: 0,
  });
  line.on("SIGINT", () => controller.abort());
  line.on("close", () => controller.abort());
  try {
    return await chooseAdminInvocation(
      program,
      {
        write: (text) => process.stdout.write(text),
        ask: async (prompt, secret = false) => {
          if (!secret)
            return line.question(prompt, { signal: controller.signal });
          process.stdout.write(prompt);
          hidden = true;
          try {
            return await line.question("", { signal: controller.signal });
          } finally {
            hidden = false;
            process.stdout.write("\n");
          }
        },
      },
      terminalDisplayLocale(process.env) === "ja",
    );
  } catch (error) {
    if (!controller.signal.aborted) throw error;
    return undefined;
  } finally {
    line.close();
  }
}

export async function chooseAdminInvocation(
  program: Command,
  terminal: MenuTerminal,
  japanese: boolean,
): Promise<AdminMenuInvocation | undefined> {
  const message = japanese
    ? {
        title: "LaTeX Renderer 管理",
        exit: "終了",
        back: "戻る",
        optional: "任意",
        required: "値を入力してください。\n",
        invalidList:
          "引用符が閉じていないか、末尾のバックスラッシュの後に文字がありません。\n",
        advanced: "任意の設定を指定しますか？ [y/N] ",
        confirm: "この操作を実行しますか？ [y/N] ",
        apiKey: "管理用APIキー（非表示）: ",
        password: "パスワード（非表示）: ",
      }
    : {
        title: "LaTeX Renderer administration",
        exit: "Exit",
        back: "Back",
        optional: "optional",
        required: "Enter a value.\n",
        invalidList: "Unclosed quote or trailing backslash.\n",
        advanced: "Set optional fields? [y/N] ",
        confirm: "Run this operation? [y/N] ",
        apiKey: "Admin API key (hidden): ",
        password: "Password (hidden): ",
      };
  const ask = async (prompt: string) => (await terminal.ask(prompt)).trim();
  const confirm = async (prompt: string) =>
    /^y(?:es)?$/i.test(await ask(prompt));
  async function select(
    command: Command,
    path: string[],
  ): Promise<{ command: Command; path: string[] } | undefined> {
    if (command.commands.length === 0) return { command, path };
    for (;;) {
      terminal.write(
        `\n${path.length === 0 ? message.title : path.join(" ")}\n`,
      );
      for (const [index, child] of command.commands.entries()) {
        const description = child.description();
        terminal.write(
          `  ${index + 1}. ${child.name()}${description ? `  ${description}` : ""}\n`,
        );
      }
      terminal.write(
        `  0. ${path.length === 0 ? message.exit : message.back}\n`,
      );
      const input = await ask("> ");
      if (input === "0" || input === "") return undefined;
      const child = /^[1-9]\d*$/.test(input)
        ? command.commands[Number(input) - 1]
        : undefined;
      if (child === undefined) continue;
      const selected = await select(child, [...path, child.name()]);
      if (selected !== undefined) return selected;
    }
  }
  async function field(
    label: string,
    mandatory: boolean,
    variadic: boolean,
  ): Promise<string[]> {
    const prompt = `${label}${mandatory ? "" : ` (${message.optional})`}: `;
    for (;;) {
      const value = await terminal.ask(prompt);
      const trimmed = value.trim();
      if (trimmed === "") {
        if (!mandatory) return [];
        terminal.write(message.required);
        continue;
      }
      if (!variadic) return [trimmed];

      const items = tokenizeList(value);
      if (items === undefined) terminal.write(message.invalidList);
      else if (items.includes("")) terminal.write(message.required);
      else return items;
    }
  }
  const selection = await select(program, []);
  if (selection === undefined) return undefined;
  const { command: selected, path } = selection;

  const positions: string[] = [];
  for (const item of selected.registeredArguments) {
    positions.push(...(await field(item.name(), item.required, item.variadic)));
  }
  const flags: string[] = [];
  let secretPrompt: string | undefined;
  const options = selected.options.filter(
    (option) => !option.hidden && option.long !== "--yes",
  );
  const optional = options.filter((option) => !option.mandatory);
  const includeOptional =
    optional.length > 0 && (await confirm(message.advanced));
  for (const option of options) {
    const flag = option.long ?? option.short;
    if (flag === undefined || (!option.mandatory && !includeOptional)) continue;
    const label = option.description
      ? `${option.flags} (${option.description})`
      : option.flags;
    if (!option.required && !option.optional) {
      if (!option.mandatory && !(await confirm(`${label}? [y/N] `))) continue;
      if (flag === "--api-key-stdin") secretPrompt = message.apiKey;
      if (flag === "--password-stdin") secretPrompt = message.password;
      flags.push(flag);
      continue;
    }
    const values = await field(label, option.mandatory, option.variadic);
    const [value] = values;
    if (value === undefined) continue;
    if (option.variadic) {
      if (values.some((item) => item.startsWith("-")))
        throw new AppError(
          "INVALID_OPTION",
          "List values must not start with a hyphen",
          400,
        );
      flags.push(flag, ...values);
    } else if (option.long !== undefined) {
      flags.push(`${flag}=${value}`);
    } else {
      // An ancestor command can consume a separate value that looks like a flag.
      flags.push(`${flag}${value}`);
    }
  }
  if (!(await confirm(message.confirm))) return undefined;
  if (selected.options.some((option) => option.long === "--yes"))
    flags.push("--yes");
  const args = [
    ...path,
    ...flags,
    ...(positions.length === 0 ? [] : ["--", ...positions]),
  ];
  if (secretPrompt === undefined) return { args };
  return { args, secret: await terminal.ask(secretPrompt, true) };
}
