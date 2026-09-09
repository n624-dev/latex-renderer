import { UpdaterSlots } from "./updater-slots.mjs";
const mode = process.argv[2];
if (process.argv.length !== 3 || !["controller", "helper"].includes(mode))
  throw new Error("Invalid Updater entry");
if ((mode === "helper") !== (process.getuid() === 0))
  throw new Error("Invalid Updater entry identity");
const slots = new UpdaterSlots("/opt/latex-renderer/updater", 0);
const state = await slots.state();
const { root } = await slots.verify(state.current);
process.chdir(root);
process.execve(
  "/usr/local/bin/node",
  [
    "/usr/local/bin/node",
    `${root}/deploy/scripts/${mode === "controller" ? "update-manager.mjs" : "update-manager-helper.mjs"}`,
  ],
  process.env,
);
