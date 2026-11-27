import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { AppError } from "@latex-renderer/shared";
import { terminalDisplayLocale } from "@latex-renderer/shared/locale";
import { clientConnections } from "@latex-renderer/setup-core";

const messages =
  terminalDisplayLocale(process.env) === "ja"
    ? {
        menu: "\n1. 接続先の追加・キーの交換  2. 既定にする  3. 旧キーを引き継ぐ  4. 削除  0. 終了\n> ",
        name: "接続名: ",
        url: "接続先のURL: ",
        key: "APIキー（非表示）: ",
        remove: (name: string) =>
          `「${name}」をこの端末から削除しますか？ [y/N] `,
        migrate: (origin: string) =>
          `保存済みAPIキーを ${origin} で使いますか？ [y/N] `,
      }
    : {
        menu: "\n1. Add or replace a key  2. Set default  3. Import saved key  4. Remove  0. Exit\n> ",
        name: "Connection name: ",
        url: "Renderer URL: ",
        key: "API key (hidden): ",
        remove: (name: string) => `Remove "${name}" from this device? [y/N] `,
        migrate: (origin: string) =>
          `Use the previously saved API key for ${origin}? [y/N] `,
      };

export async function connectionMenu(): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new AppError(
      "TERMINAL_REQUIRED",
      "Open a terminal or use a connection subcommand",
      400,
    );
  const store = clientConnections();
  let hidden = false;
  const output = new Writable({
    write(chunk: Buffer, _encoding, done) {
      if (hidden) done();
      else process.stdout.write(chunk, done);
    },
  });
  const controller = new AbortController();
  const terminal = createInterface({
    input: process.stdin,
    output,
    terminal: true,
    historySize: 0,
  });
  terminal.on("SIGINT", () => controller.abort());
  terminal.on("close", () => controller.abort());
  const ask = async (prompt: string) =>
    (await terminal.question(prompt, { signal: controller.signal })).trim();
  try {
    for (;;) {
      controller.signal.throwIfAborted();
      const connections = await store.list();
      for (const { name, origin, default: selected } of connections)
        process.stdout.write(`${selected ? "*" : " "} ${name}  ${origin}\n`);
      const action = await ask(messages.menu);
      if (action === "0" || action === "") return;
      if (!["1", "2", "3", "4"].includes(action)) continue;
      const name = await ask(messages.name);
      if (!name) continue;
      try {
        if (action === "2") await store.select(name);
        else if (action === "4") {
          if ((await ask(messages.remove(name))) === "y")
            await store.remove(name);
        } else {
          const url = await ask(messages.url);
          if (!url) continue;
          const { origin } = await store.target(name, url);
          if (action === "3") {
            if ((await ask(messages.migrate(origin))) === "y")
              await store.migrate(name, origin);
          } else {
            process.stdout.write(messages.key);
            hidden = true;
            let key: string;
            try {
              key = await ask("");
            } finally {
              hidden = false;
              process.stdout.write("\n");
            }
            if (key) await store.save(name, origin, key);
          }
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        if (!(error instanceof AppError)) throw error;
        process.stdout.write(error.message + "\n");
      }
    }
  } catch (error) {
    if (!controller.signal.aborted) throw error;
  } finally {
    terminal.close();
  }
}
