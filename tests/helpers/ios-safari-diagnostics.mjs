import { Buffer } from "node:buffer";
import { execFile, spawnSync } from "node:child_process";
import {
  appendFileSync,
  closeSync,
  mkdirSync,
  openSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export function createSafariDiagnostics(root, device) {
  const directory = join(
    root,
    device.name.startsWith("iPhone") ? "iphone" : "ipad",
  );
  mkdirSync(directory, { recursive: true });
  const path = (name) => join(directory, name);
  function event(name, values = {}) {
    appendFileSync(
      path("timeline.jsonl"),
      JSON.stringify({
        time: new Date().toISOString(),
        event: name,
        ...values,
      }) + "\n",
    );
  }
  function simctl(name, args, timeout = 15_000) {
    const output = openSync(path(name), "w");
    try {
      const result = spawnSync("xcrun", ["simctl", ...args], {
        timeout,
        stdio: ["ignore", output, output],
      });
      event("diagnostic.simctl", {
        args,
        status: result.status,
        signal: result.signal,
        error: result.error?.message,
      });
      return result;
    } finally {
      closeSync(output);
    }
  }
  async function openUrl(url) {
    const args = ["openurl", device.udid, url];
    let result;
    try {
      result = {
        ...(await run("xcrun", ["simctl", ...args], { timeout: 45_000 })),
        status: 0,
      };
    } catch (error) {
      result = {
        stdout: error.stdout ?? "",
        stderr: error.stderr ?? "",
        status: typeof error.code === "number" ? error.code : null,
        signal: error.signal,
        error: error.message,
      };
    }
    writeFileSync(path("open-url.log"), result.stdout + result.stderr);
    event("diagnostic.simctl", {
      args,
      status: result.status,
      signal: result.signal,
      error: result.error,
    });
    return result.status;
  }
  async function screenshot(name, safari) {
    const imagePath = path(`${name}.png`);
    if (safari) {
      try {
        const encoded = await safari.run("/screenshot");
        const png =
          typeof encoded === "string" && Buffer.from(encoded, "base64");
        if (!png || png.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a")
          throw new Error("Appium did not return a PNG");
        writeFileSync(imagePath, png);
        event("diagnostic.screenshot", { name, source: "appium" });
        return;
      } catch (error) {
        event("diagnostic.failed", {
          name,
          source: "appium",
          error: String(error),
        });
      }
    }
    simctl(`${name}.log`, ["io", device.udid, "screenshot", imagePath]);
    if (statSync(imagePath, { throwIfNoEntry: false })?.size)
      event("diagnostic.screenshot", { name, source: "simctl" });
    else
      event("diagnostic.failed", {
        name,
        source: "simctl",
        error: "No image captured",
      });
  }
  async function collect(error, safari, web) {
    if (error) writeFileSync(path("failure.txt"), error.stack ?? String(error));
    await screenshot("screenshot", safari);
    simctl(
      "safari-system.log",
      [
        "spawn",
        device.udid,
        "log",
        "show",
        "--last",
        "20m",
        "--info",
        "--debug",
        "--predicate",
        'process == "MobileSafari" OR process BEGINSWITH "com.apple.WebKit" OR process BEGINSWITH "WebDriverAgent"',
      ],
      30_000,
    );
    if (!safari) return;
    async function save(name, collectValue) {
      try {
        const value = await collectValue();
        writeFileSync(
          path(name),
          typeof value === "string" ? value : JSON.stringify(value, null, 2),
        );
      } catch (inspectionError) {
        event("diagnostic.failed", { name, error: String(inspectionError) });
      }
    }
    let contexts = [];
    await save("contexts.json", async () => {
      contexts = await safari.run("/contexts");
      return contexts;
    });
    const webContext =
      web ?? contexts.find((name) => name.startsWith("WEBVIEW"));
    if (webContext) {
      await save("safari-source.html", async () => {
        await safari.context(webContext);
        return safari.execute("return document.documentElement.outerHTML");
      });
      await save("safari-state.json", () =>
        safari.execute(`
      const box = (selector) => document.querySelector(selector)?.getBoundingClientRect().toJSON();
      return {
        url: location.href,
        language: document.documentElement.lang,
        userAgent: navigator.userAgent,
        viewport: {
          width: visualViewport.width, height: visualViewport.height, scale: visualViewport.scale,
          offsetLeft: visualViewport.offsetLeft, offsetTop: visualViewport.offsetTop,
          innerWidth, innerHeight, scrollX, scrollY, devicePixelRatio,
        },
        orientation: screen.orientation?.type,
        activeElement: document.activeElement?.className,
        editor: box(".cm-content"),
        canvas: box("#editor-canvas"),
        draftStatus: document.querySelector("#editor-save-status")?.textContent,
        previewStatus: document.querySelector("#editor-preview-status")?.textContent,
        resources: performance.getEntriesByType("resource").map(entry => entry.toJSON()),
      };
    `),
      );
    }
    await save("native-source.xml", async () => {
      await safari.context("NATIVE_APP");
      return safari.run("/source");
    });
  }
  event("device.selected", {
    device: device.name,
    runtime: device.version,
    udid: device.udid,
  });
  return { path, event, simctl, openUrl, screenshot, collect };
}
