import { readFile, writeFile } from "node:fs/promises";
import { ciHostname } from "./standalone-fixture.mjs";

// Called only after the CI entry has checked its sealed run/boot marker and
// finished downloading and verifying the baseline. Never used by an installer.
export async function activateStandaloneHttps(run) {
  run("/usr/sbin/update-ca-certificates", []);
  const hosts = await readFile("/etc/hosts", "utf8");
  const present = hosts
    .split(/\r?\n/)
    .some((line) =>
      line.split("#", 1)[0].trim().split(/\s+/).slice(1).includes(ciHostname),
    );
  if (!present)
    await writeFile("/etc/hosts", hosts + `\n127.0.0.1 ${ciHostname}\n`);
  run("/usr/sbin/nginx", ["-t"]);
  run("/usr/bin/systemctl", ["start", "nginx"]);
}
