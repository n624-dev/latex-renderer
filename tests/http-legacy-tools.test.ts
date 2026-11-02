import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";

it.skipIf(process.platform === "win32")(
  "installs listeners omitted by the old trusted host tools before enabling the new release",
  () => {
    const driver = readFileSync(
      "deploy/scripts/deploy-production-release.sh",
      "utf8",
    );
    const start = driver.indexOf(
      'LATEX_RENDERER_PREPARE_SOURCE="$source_root" \\\n  sh "$tools_root/deploy/scripts/prepare-host.sh"',
    );
    const end = driver.indexOf(
      'if [ "$deployment_mode" = cloudflare ]; then',
      start,
    );
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const stage = driver.slice(start, end);
    for (const [fixed, legacy] of [
      [false, false],
      [true, false],
      [true, true],
    ]) {
      const root = mkdtempSync(join(tmpdir(), "http-old-tools-"));
      try {
        const source = join(root, "source"),
          tools = join(root, "old"),
          units = join(root, "units");
        for (const name of [
          join(source, "deploy/systemd"),
          join(source, "deploy/scripts"),
          join(tools, "deploy/scripts"),
          units,
        ])
          mkdirSync(name, { recursive: true });
        if (!legacy)
          writeFileSync(
            join(source, "deploy/scripts/http-idle-server.mjs"),
            "// fixture marker\n",
          );
        const names = [
          "api",
          "web",
          "admin-web",
          "admin-api",
          "internal-api",
          "remote-mcp",
        ];
        for (const name of names)
          for (const suffix of legacy ? ["service"] : ["service", "socket"])
            writeFileSync(
              join(
                source,
                "deploy/systemd",
                `latex-renderer-${name}.${suffix}`,
              ),
              `[${suffix === "service" ? "Service" : "Socket"}]\n`,
            );
        // Model the released pre-activation installer: service files only.
        writeFileSync(
          join(tools, "deploy/scripts/prepare-host.sh"),
          'for f in "$LATEX_RENDERER_PREPARE_SOURCE"/deploy/systemd/*.service; do cp "$f" "$UNIT_ROOT/"; done\n',
        );
        const probe = join(root, "probe.mjs");
        writeFileSync(
          probe,
          `
          import assert from 'node:assert/strict';
          import {existsSync,readdirSync} from 'node:fs';
          import {join} from 'node:path';
          import {prepareHttpActivation,controlService,httpServiceStatus} from ${JSON.stringify(pathToFileURL(resolve("deploy/scripts/http-services.mjs")).href)};
          const unitRoot=process.env.UNIT_ROOT, states=new Map();
          const run=(action,...args)=>{
            const name=args.at(-1), present=existsSync(join(unitRoot,name??''));
            if(action==='show')return 'LoadState='+(present?'loaded':'not-found')+'\\nActiveState='+(states.get(name)?.active?'active':'inactive')+'\\nSubState=listening\\nResult=success\\nUnitFileState='+(states.get(name)?.enabled?'enabled':'disabled');
            if(action==='is-enabled')return 'disabled';
            if(action==='daemon-reload')return '';
            const value=states.get(name)??{};
            if(action==='enable')value.enabled=true;
            if(action==='disable')value.enabled=false;
            if(action==='start')value.active=true;
            if(action==='stop')value.active=false;
            states.set(name,value);return '';
          };
          prepareHttpActivation(process.env.source_root,{unitRoot,run,values:{}});
          for(const name of ${JSON.stringify(names)}){
            const unit='latex-renderer-'+name+'.service';
            controlService('enable',unit,{run,enabled:true});controlService('start',unit,{run,enabled:true});
            assert.equal(httpServiceStatus(unit,{run,aliases:false}).state,'idle');
          }
          assert.equal(readdirSync(unitRoot).filter(n=>n.endsWith('.socket')).length,6);
        `,
        );
        // Keep every filesystem mutation in the fixture; execute the production
        // shell stage and real lifecycle module, never systemd on this host.
        const shell = `
          install() {
            test "$1 $2 $3 $4 $5 $6" = '-o root -g root -m 0644'; shift 6
            while [ "$#" -gt 1 ]; do cp "$1" "$UNIT_ROOT/"; shift; done
            test "$1" = /etc/systemd/system/
          }
          systemctl() { test "$1" = daemon-reload; }
          http_control() { test "$1" = prepare; "$NODE_BINARY" "$PROBE"; }
          ${fixed ? stage : stage.slice(0, stage.indexOf("# The running Updater"))}
          ${legacy ? "" : '"$NODE_BINARY" "$PROBE"'}
        `;
        const result = spawnSync("/bin/sh", ["-eu", "-c", shell], {
          encoding: "utf8",
          timeout: 10000,
          env: {
            ...process.env,
            source_root: source,
            tools_root: tools,
            release_id: "fixture",
            UNIT_ROOT: units,
            NODE_BINARY: process.execPath,
            PROBE: probe,
          },
        });
        if (fixed) {
          expect(result.status, result.stderr).toBe(0);
          expect(
            readdirSync(units).filter((name) => name.endsWith(".socket"))
              .length,
          ).toBe(legacy ? 0 : 6);
        } else {
          expect(result.status).not.toBe(0);
          expect(result.stderr).toContain(
            "HTTP activation socket is not installed",
          );
        }
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  },
);
