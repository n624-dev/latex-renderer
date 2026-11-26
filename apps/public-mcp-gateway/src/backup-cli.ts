import {
  backUpGatewayDatabase,
  prepareRestoredGatewayDatabase,
} from "./backup.js";

const controller = new AbortController();
for (const name of ["SIGINT", "SIGTERM"] as const)
  process.once(name, () => controller.abort());
const [action, source, destination, key, ...extra] = process.argv.slice(2);
const {
  GATEWAY_DATABASE: databasePath,
  GATEWAY_BACKUP_DIRECTORY: backupDirectory,
  GATEWAY_BACKUP_RECIPIENT_FILE: recipientFile,
} = process.env;
const now = Date.now(),
  signal = controller.signal;
if (
  action === "backup" &&
  source === undefined &&
  databasePath &&
  backupDirectory &&
  recipientFile
) {
  await backUpGatewayDatabase({
    databasePath,
    backupDirectory,
    recipientFile,
    now,
    signal,
  });
  console.log("Created encrypted gateway backup and applied retention.");
} else if (
  action === "prepare-restore" &&
  source &&
  destination &&
  key &&
  extra.length === 0
) {
  const count = await prepareRestoredGatewayDatabase({
    backupPath: source,
    destination,
    identityFile: key,
    now,
    signal,
  });
  console.log(
    `Prepared gateway database with ${count} authorizations invalidated.`,
  );
} else {
  throw new Error(
    "Usage: backup-cli.js backup | prepare-restore BACKUP UNUSED_DATABASE AGE_IDENTITY",
  );
}
