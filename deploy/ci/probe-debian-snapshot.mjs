import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

// Read-only, bounded transport diagnostics. Never prints response bodies, IPs,
// credentials or proxy settings; downloaded bytes are not used for installation.
const snapshot = process.argv[2] ?? "20260812T235959Z";
if (!/^\d{8}T\d{6}Z$/.test(snapshot))
  throw new Error("Invalid Debian snapshot timestamp");
const deadline = Date.now() + 150_000;
for (const host of ["snapshot.debian.org", "snapshot-cloudflare.debian.org"])
  for (const scheme of ["http", "https"])
    for (const archive of ["debian", "debian-security"])
      for (const agent of ["curl", "apt"]) {
        if (Date.now() >= deadline) {
          console.log(JSON.stringify({ event: "debian_probe.deadline" }));
          process.exit(0);
        }
        const suite = archive === "debian" ? "bookworm" : "bookworm-security";
        const url = `${scheme}://${host}/archive/${archive}/${snapshot}/dists/${suite}/InRelease`;
        const args = [
          "--silent", "--show-error", "--http1.1", "--location",
          "--max-redirs", "3", "--connect-timeout", "5", "--max-time", "12",
          "--max-filesize", "262144", "--write-out",
          "\n%{http_code} %{time_starttransfer} %{time_total} %{size_download}",
        ];
        if (agent === "apt") args.push("--user-agent", "Debian APT-HTTP/1.3 (2.6.1)");
        let output = "", status = 0;
        try {
          output = execFileSync("curl", [...args, "--", url], {
            encoding: "utf8", timeout: 15_000, maxBuffer: 512 * 1024,
            stdio: ["ignore", "pipe", "pipe"],
          });
        } catch (error) {
          status = Number.isInteger(error.status) ? error.status : -1;
          output = error.stdout?.toString() ?? "";
        }
        const end = output.lastIndexOf("\n");
        const body = output.slice(0, end), parts = output.slice(end + 1).trim().split(/\s+/);
        console.log(JSON.stringify({
          event: "debian_probe.result", host, scheme, archive, snapshot, agent,
          exit: status, http: parts[0], firstByteSeconds: parts[1], totalSeconds: parts[2],
          bytes: Buffer.byteLength(body), sha256: createHash("sha256").update(body).digest("hex"),
          signedHeader: body.startsWith("-----BEGIN PGP SIGNED MESSAGE-----"),
          noHealthyBackends: body.includes("No healthy backends"),
        }));
      }
