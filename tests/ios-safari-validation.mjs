import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { execFileSync, spawn } from "node:child_process";
import console from "node:console";
import { closeSync, openSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import process from "node:process";
import { setTimeout } from "node:timers/promises";
import { startEditorBrowserFixture } from "./fixtures/editor-browser-server.mjs";
import { createSafariDiagnostics } from "./helpers/ios-safari-diagnostics.mjs";

const appium = "http://127.0.0.1:4723";
const elementId = "element-6066-11e4-a52e-4f735466cecf";
const models = ["iPhone 17", "iPad (A16)"];

function simulatorInventory(kind) {
  return JSON.parse(
    execFileSync("xcrun", ["simctl", "list", kind, "-j"], {
      encoding: "utf8",
      timeout: 15_000,
    }),
  )[kind];
}

function selectSimulators() {
  const devices = simulatorInventory("devices");
  const versions = new Intl.Collator("en", { numeric: true });
  const runtimes = simulatorInventory("runtimes")
    .filter(
      (runtime) =>
        runtime.isAvailable &&
        runtime.identifier.startsWith(
          "com.apple.CoreSimulator.SimRuntime.iOS-26-",
        ),
    )
    .sort((first, second) => versions.compare(second.version, first.version));
  for (const runtime of runtimes) {
    const pair = models.map((name) =>
      devices[runtime.identifier]?.find(
        (device) => device.isAvailable && device.name === name,
      ),
    );
    if (pair.every((device) => device !== undefined))
      return pair.map((device) => ({ ...device, version: runtime.version }));
  }
  throw new Error(
    `No installed iOS 26 runtime has both ${models.join(" and ")}`,
  );
}

function command(path, parameters, { method, timeout = 30_000 } = {}) {
  // Session creation includes booting the device. The HTTP client's default
  // response-headers deadline must not preempt the explicit session deadline.
  const body =
    parameters === undefined ? undefined : JSON.stringify(parameters);
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      appium + path,
      {
        method: method ?? (body === undefined ? "GET" : "POST"),
        ...(body === undefined
          ? {}
          : {
              headers: {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(body),
              },
            }),
        signal: globalThis.AbortSignal.timeout(timeout),
      },
      (response) => {
        response.setEncoding("utf8");
        let text = "";
        response.on("data", (chunk) => {
          text += chunk;
        });
        response.on("error", reject);
        response.on("end", () => {
          try {
            const { value } = JSON.parse(text);
            if (response.statusCode !== 200 || value?.error)
              throw new Error(
                `Appium ${path}: ${value?.message ?? response.statusCode}`,
              );
            resolve(value);
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    request.on("error", reject);
    request.end(body);
  });
}

async function waitFor(description, probe, timeout = 15_000) {
  const result = await pollFor(probe, timeout);
  if (result) return result;
  throw new Error(`Timed out waiting for ${description}`);
}

async function pollFor(probe, timeout) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const result = await probe();
    if (result) return result;
    await setTimeout(250);
  }
}

function startAppium(diagnostics) {
  const log = openSync(diagnostics.path("appium.log"), "w");
  let child;
  try {
    child = spawn(
      process.env.IOS_SAFARI_APPIUM,
      [
        "--address",
        "127.0.0.1",
        "--port",
        "4723",
        "--log-level",
        "debug",
        "--log-timestamp",
        "--log-no-colors",
        "--allow-insecure",
        "xcuitest:customize_result_bundle_path",
      ],
      { detached: true, stdio: ["ignore", log, log] },
    );
  } finally {
    closeSync(log);
  }
  const stopped = new Promise((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
    child.once("error", (error) => resolve({ error: error.message }));
  });
  return {
    ready: () =>
      waitFor(
        "Appium readiness",
        async () => {
          if (
            !child.pid ||
            child.exitCode !== null ||
            child.signalCode !== null
          )
            throw new Error("Appium exited before becoming ready");
          try {
            return (await command("/status", undefined, { timeout: 2000 }))
              .ready;
          } catch {
            return false;
          }
        },
        120_000,
      ),
    async stop() {
      const signal = (name) => {
        if (!child.pid || child.exitCode !== null || child.signalCode !== null)
          return;
        try {
          process.kill(-child.pid, name);
        } catch (error) {
          if (error.code !== "ESRCH") throw error;
        }
      };
      signal("SIGTERM");
      const result = await Promise.race([
        stopped,
        setTimeout(12_000, null, { ref: false }),
      ]);
      if (result === null) signal("SIGKILL");
      diagnostics.event("appium.stopped", result ?? (await stopped));
    },
  };
}

function onSession(sessionId) {
  const run = (path, body, options) =>
    command(`/session/${sessionId}${path}`, body, options);
  return {
    run,
    context: (name) => run("/context", { name }),
    execute: (script, ...args) => run("/execute/sync", { script, args }),
    find: async (using, value) => {
      const elements = await run("/elements", { using, value });
      return elements[0]?.[elementId];
    },
  };
}

async function nativeCoordinates(safari) {
  const mapping = await safari.execute(
    "mobile: calibrateWebToRealCoordinatesTranslation",
  );
  for (const key of ["offsetX", "offsetY", "pixelRatioX", "pixelRatioY"])
    assert.ok(
      Number.isFinite(mapping[key]),
      `Missing native coordinate mapping: ${key}`,
    );
  return mapping;
}

async function dismissSafariToolbarTip(safari, diagnostics) {
  const tip = await safari.find(
    "-ios predicate string",
    'type == "XCUIElementTypeStaticText" AND label BEGINSWITH "View Bookmarks, Share Menu"',
  );
  if (!tip) return;
  const close = await safari.find(
    "-ios predicate string",
    'type == "XCUIElementTypeButton" AND visible == 1 AND (label == "Close" OR label == "Dismiss")',
  );
  diagnostics.event("safari.toolbar-tip", { closeButtonFound: Boolean(close) });
  if (close) await safari.run(`/element/${close}/click`, {});
}

async function showSoftwareKeyboard(safari, web, diagnostics) {
  const height = await safari.execute("return visualViewport.height");
  // A first-launch Safari tip can consume the first tap outside its panel.
  // Repeat a real tap on a visible line after recording what blocked the input.
  for (let attempt = 1; attempt <= 3; attempt++) {
    await safari.context("NATIVE_APP");
    await dismissSafariToolbarTip(safari, diagnostics);
    await safari.context(web);
    const point = await waitFor("a visible, editable TeX line", () =>
      safari.execute(`
        const line = document.querySelector(".cm-content[contenteditable=true] .cm-line");
        if (!line) return null;
        line.scrollIntoView({ block: "center" });
        const rect = line.getBoundingClientRect();
        const x = Math.max(0, rect.left) + Math.min(24, rect.width / 2);
        const y = rect.top + rect.height / 2;
        return line.contains(document.elementFromPoint(x, y)) ? { x, y } : null;
      `),
    );
    const mapping = await nativeCoordinates(safari);
    const x = Math.round(mapping.offsetX + point.x * mapping.pixelRatioX);
    const y = Math.round(mapping.offsetY + point.y * mapping.pixelRatioY);
    diagnostics.event("keyboard.tap", { attempt, point, mapping, x, y });
    await safari.context("NATIVE_APP");
    await safari.execute("mobile: tap", { x, y });
    const keyboard = await pollFor(
      () => safari.find("class name", "XCUIElementTypeKeyboard"),
      8_000,
    );
    if (keyboard) {
      await safari.context(web);
      return height;
    }
    diagnostics.event("keyboard.absent-after-tap", { attempt });
    await diagnostics.screenshot(`keyboard-tap-${attempt}`, safari);
    try {
      writeFileSync(
        diagnostics.path(`keyboard-tap-${attempt}.xml`),
        await safari.run("/source"),
      );
    } catch (error) {
      diagnostics.event("diagnostic.failed", {
        name: `keyboard-tap-${attempt}.xml`,
        error: String(error),
      });
    }
  }
  throw new Error("Timed out waiting for the iOS software keyboard");
}

async function pinchPdf(safari, diagnostics) {
  const area = await safari.execute(`
    const canvas = document.querySelector("#editor-canvas");
    canvas.scrollIntoView({ block: "center" });
    const rect = canvas.getBoundingClientRect();
    const left = Math.max(rect.left, 0), right = Math.min(rect.right, visualViewport.width);
    const top = Math.max(rect.top, 0), bottom = Math.min(rect.bottom, visualViewport.height);
    return { x: (left + right) / 2, y: (top + bottom) / 2,
      radius: Math.min(80, (right - left) / 3) };
  `);
  assert.ok(area.radius >= 20, "The PDF must be visible before the gesture");
  const scale = await safari.execute("return window.visualViewport.scale");
  assert.ok(
    Number.isFinite(scale) && scale > 0,
    "Missing PDF zoom before the gesture",
  );
  const mapping = await nativeCoordinates(safari);
  diagnostics.event("pdf.gesture", { area, mapping });
  const pointer = (direction) => {
    const move = (fraction, duration) => ({
      type: "pointerMove",
      origin: "viewport",
      duration,
      x: Math.round(
        mapping.offsetX +
          (area.x + direction * area.radius * fraction) * mapping.pixelRatioX,
      ),
      y: Math.round(mapping.offsetY + area.y * mapping.pixelRatioY),
    });
    return {
      type: "pointer",
      id: direction < 0 ? "left-finger" : "right-finger",
      parameters: { pointerType: "touch" },
      actions: [
        move(0.3, 0),
        { type: "pointerDown", button: 0 },
        { type: "pause", duration: 100 },
        move(1, 600),
        { type: "pointerUp", button: 0 },
      ],
    };
  };
  await safari.context("NATIVE_APP");
  await safari.run("/actions", { actions: [pointer(-1), pointer(1)] });
  return scale;
}

async function checkMobileSafari(device) {
  const diagnostics = createSafariDiagnostics(
    process.env.IOS_SAFARI_DIAGNOSTICS,
    device,
  );
  const label = `${device.name} (iOS ${device.version})`;
  let sessionId, fixture, safari, web, failure, server;
  let editorRequested = false;
  try {
    fixture = await startEditorBrowserFixture({
      onRequest: (request) => {
        diagnostics.event("fixture.http", request);
        if (
          request.method === "GET" &&
          request.path === fixture?.editorPath &&
          request.status === 200
        )
          editorRequested = true;
      },
    });
    const url = fixture.origin + fixture.editorPath + "?locale=ja";
    server = startAppium(diagnostics);
    await server.ready();
    const started = Date.now();
    console.log(
      `${label}: starting Simulator and Safari with prebuilt WebDriverAgent`,
    );
    const session = await command(
      "/session",
      {
        capabilities: {
          alwaysMatch: {
            platformName: "iOS",
            "appium:automationName": "XCUITest",
            "appium:bundleId": "com.apple.mobilesafari",
            "appium:includeSafariInWebviews": true,
            "appium:newCommandTimeout": 300,
            "appium:webviewConnectTimeout": 45_000,
            "appium:udid": device.udid,
            "appium:deviceName": device.name,
            "appium:platformVersion": device.version,
            "appium:orientation": "PORTRAIT",
            "appium:nativeWebTap": true,
            "appium:connectHardwareKeyboard": false,
            "appium:forceSimulatorSoftwareKeyboardPresence": true,
            "appium:showXcodeLog": true,
            "appium:useNewWDA": true,
            "appium:usePrebuiltWDA": true,
            "appium:derivedDataPath": process.env.IOS_SAFARI_WDA_BUILD,
            "appium:simulatorStartupTimeout": 9 * 60_000,
            "appium:wdaLaunchTimeout": 3 * 60_000,
            "appium:wdaStartupRetries": 1,
            "appium:resultBundlePath": diagnostics.path("webdriver.xcresult"),
            "appium:showSafariConsoleLog": true,
            "appium:showSafariNetworkLog": true,
            "appium:safariLogAllCommunication": true,
            "appium:safariLogAllCommunicationHexDump": true,
            "appium:showIOSLog": true,
            "appium:screenshotQuality": 0,
            "appium:iosSyslogFile": diagnostics.path("ios-live.log"),
          },
        },
      },
      { timeout: 14 * 60_000 },
    );
    sessionId = session.sessionId;
    assert.ok(sessionId, "Appium did not return a session ID");
    console.log(`${label}: native Safari session started`);
    diagnostics.event("safari.native.connected", {
      elapsedMs: Date.now() - started,
      capabilities: session.capabilities,
    });
    diagnostics.simctl("boot-status.log", ["list", "devices", "booted"]);
    safari = onSession(sessionId);
    await diagnostics.screenshot("simulator-ready", safari);
    // The fixture needs the Node event loop while Safari opens the URL.
    const openStatus = await diagnostics.openUrl(url);
    // A busy Simulator can finish navigating after openurl reports a timeout.
    // Require the HTTP response and the matching Safari page before continuing.
    if (openStatus !== 0)
      diagnostics.event("safari.open-url.unconfirmed", { status: openStatus });
    await waitFor(
      "Safari to request the editor page",
      () => editorRequested,
      180_000,
    );
    web = await waitFor(
      "the Safari Web Inspector context for the editor page",
      async () => {
        const contexts = await safari.run("/contexts", undefined, {
          timeout: 65_000,
        });
        for (const name of contexts) {
          if (!name.startsWith("WEBVIEW")) continue;
          try {
            await safari.context(name);
            const page = await safari.execute(
              "return location.origin + location.pathname",
            );
            if (page === fixture.origin + fixture.editorPath) return name;
          } catch (error) {
            diagnostics.event("safari.context.unavailable", {
              name,
              error: String(error),
            });
          }
        }
        return undefined;
      },
      120_000,
    );
    await safari.context(web);
    diagnostics.event("safari.connected", { webContext: web });
    const portraitWidth = await safari.execute("return innerWidth");
    diagnostics.event("viewport.portrait", { width: portraitWidth });
    const checks = [];
    async function check(name, run) {
      try {
        await safari.context(web);
        await run();
        diagnostics.event("check.passed", { name });
      } catch (error) {
        diagnostics.event("check.failed", { name, error: String(error) });
        await diagnostics.screenshot(name + "-failed", safari);
        checks.push(error);
      }
    }
    async function restorePortrait() {
      await safari.execute("document.activeElement.blur()");
      await safari.context("NATIVE_APP");
      await safari.run("/orientation", { orientation: "PORTRAIT" });
      await safari.context(web);
      await waitFor("the restored portrait Safari layout", () =>
        safari.execute("return innerWidth === arguments[0]", portraitWidth),
      );
    }

    await check("workspace", async () => {
      const ui = await waitFor("the loaded workspace", () =>
        safari.execute(`
          const code = document.querySelector(".cm-content[contenteditable=true]");
          const file = document.querySelector("#editor-files:enabled");
          if (!code || !file || document.fonts.status !== "loaded") return null;
          const visible = (selector) => document.querySelector(selector).getClientRects().length > 0;
          const font = (selector) => getComputedStyle(document.querySelector(selector)).fontFamily;
          return {
            uiFont: font("body"),
            fileFont: font("#editor-files"),
            buttonFont: font("#editor-build"),
            codeFont: font(".cm-scroller"),
            codeTop: code.getBoundingClientRect().top,
            overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            previewVisible: visible("#editor-preview-body"),
            tabsVisible: visible("#editor-panels"),
            cancelVisible: visible("#editor-cancel"),
            errorTabVisible: visible("#editor-error-tab"),
            loadedWebFonts: [...document.fonts]
              .filter((face) => face.status === "loaded")
              .map((face) => face.family),
          };
        `),
      );
      diagnostics.event("workspace.styles", { ui });
      const compact = portraitWidth <= 720;
      assert.equal(ui.fileFont, ui.uiFont);
      assert.equal(ui.buttonFont, ui.uiFont);
      assert.match(ui.codeFont, /monospace/);
      assert.ok(ui.overflow <= 0, "Workspace overflows horizontally");
      assert.ok(ui.codeTop < (compact ? 240 : 173), "Code starts below the workspace toolbar");
      assert.equal(ui.previewVisible, !compact);
      assert.equal(ui.tabsVisible, compact);
      assert.equal(ui.cancelVisible, false);
      assert.equal(ui.errorTabVisible, false);
      await diagnostics.screenshot("editor-ready", safari);

      await safari.execute('document.querySelector("[data-editor-dialog=editor-settings-dialog]").click()');
      try {
        assert.equal(
          await safari.execute('return document.querySelector("#editor-settings-dialog").matches(":modal") && getComputedStyle(document.querySelector("#editor-language")).fontFamily === getComputedStyle(document.body).fontFamily'),
          true,
        );
        await diagnostics.screenshot("editor-settings", safari);
      } finally {
        await safari.execute('document.querySelector("#editor-settings-dialog button[type=submit]").click()');
      }
      console.log(`${label}: workspace layout, shared UI font, and settings passed`);
    });

    await check("keyboard", async () => {
      const height = await showSoftwareKeyboard(safari, web, diagnostics);
      await waitFor("the resized Safari viewport and the focused editor", () =>
        safari.execute(
          "return visualViewport.height < arguments[0] && document.activeElement.matches('.cm-content')",
          height,
        ),
      );
      console.log(`${label}: software keyboard and focused editor passed`);
      diagnostics.event("keyboard.visible", {
        height: await safari.execute("return visualViewport.height"),
      });
      await diagnostics.screenshot("keyboard-visible", safari);
    });

    await check("rotation", async () => {
      await safari.context("NATIVE_APP");
      await safari.run("/orientation", { orientation: "LANDSCAPE" });
      await safari.context(web);
      const landscapeWidth = await waitFor("the landscape Safari layout", () =>
        safari.execute(
          "return innerWidth > arguments[0] ? innerWidth : 0",
          portraitWidth,
        ),
      );
      diagnostics.event("viewport.landscape", { width: landscapeWidth });
      await diagnostics.screenshot("landscape", safari);
      assert.equal(
        await safari.execute(
          "return document.querySelector('.cm-content').textContent.includes('Original')",
        ),
        true,
      );
      await restorePortrait();
      console.log(`${label}: landscape and portrait rotation passed`);
    });

    await check("pinch", async () => {
      if ((await safari.execute("return innerWidth")) !== portraitWidth)
        await restorePortrait();
      await safari.execute(
        "document.querySelector('[data-panel=preview]').click()",
      );
      await waitFor("the rendered PDF canvas", () =>
        safari.execute(
          "const canvas = document.querySelector('#editor-canvas'); return !canvas.hidden && canvas.width > 0 && canvas.getBoundingClientRect().height > 0",
        ),
      );
      const scale = await pinchPdf(safari, diagnostics);
      await safari.context(web);
      const zoomedScale = await waitFor(
        "the Safari pinch zoom on the PDF",
        () =>
          safari.execute(
            "return visualViewport.scale > arguments[0] + 0.05 && !document.querySelector('#editor-canvas').hidden ? visualViewport.scale : 0",
            scale,
          ),
      );
      diagnostics.event("pdf.pinch", { before: scale, after: zoomedScale });
      await diagnostics.screenshot("pdf-pinch", safari);
      console.log(`${label}: native pinch on the PDF passed`);
    });
    if (checks.length > 0)
      throw new AggregateError(checks, "Safari gesture validation failed");
  } catch (error) {
    failure = error;
  }
  async function finish(stage, operation) {
    try {
      await operation();
    } catch (error) {
      console.error(`${label}: ${stage}: ${String(error)}`);
      failure ??= error;
    }
  }
  await finish("collect diagnostics", () =>
    diagnostics.collect(failure, safari, web),
  );
  if (sessionId)
    await finish("close the Safari session", async () => {
      try {
        await command(`/session/${sessionId}`, undefined, { method: "DELETE" });
      } catch (error) {
        if (
          !(error instanceof Error) ||
          error.name !== "AbortError" ||
          !(error.cause instanceof Error) ||
          error.cause.name !== "TimeoutError"
        )
          throw error;
        // Appium can keep deleting the session after the HTTP client times out.
        // Check that the process exits and its Simulator shuts down below.
        diagnostics.event("safari.session-close.timeout", { error: String(error) });
        console.warn(`${label}: session close timed out; checking Simulator shutdown`);
      }
    });
  await finish("close the Web fixture", () => fixture?.close());
  await finish("stop Appium", () => server?.stop());
  await finish("shut down the Simulator", async () => {
    const shutdown = diagnostics.simctl(
      "shutdown.log",
      ["shutdown", device.udid],
      30_000,
    );
    if (shutdown.status !== 0)
      await waitFor("the Simulator to shut down", () =>
        Object.values(simulatorInventory("devices"))
          .flat()
          .some((item) => item.udid === device.udid && item.state === "Shutdown"),
      );
  });
  if (failure) throw failure;
}

if (process.platform !== "darwin")
  throw new Error("The iOS Simulator requires macOS and Xcode");
if (
  !process.env.IOS_SAFARI_DIAGNOSTICS ||
  !process.env.IOS_SAFARI_APPIUM ||
  !process.env.IOS_SAFARI_WDA_BUILD
)
  throw new Error(
    "Set IOS_SAFARI_DIAGNOSTICS, IOS_SAFARI_APPIUM and IOS_SAFARI_WDA_BUILD",
  );
const devices = selectSimulators();
const failures = [];
for (const device of devices) {
  try {
    await checkMobileSafari(device);
  } catch (error) {
    failures.push(error);
    console.error(`${device.name}: ${String(error)}`);
  }
}
if (failures.length > 0)
  throw new AggregateError(failures, "iOS Safari validation failed");
