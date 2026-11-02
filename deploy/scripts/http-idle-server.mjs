import { fstatSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { Server } from "node:http";
import { performance } from "node:perf_hooks";
import { clearTimeout, setTimeout } from "node:timers";
import { boundedIntegerEnvironment } from "./environment.mjs";

export function httpIdleConfiguration(environment = process.env) {
  const enabled = environment.HTTP_IDLE_ENABLED ?? "true";
  if (!["true", "false"].includes(enabled))
    throw new Error("HTTP_IDLE_ENABLED must be true or false");
  return {
    enabled: enabled === "true",
    timeoutMs:
      1000 *
      boundedIntegerEnvironment(
        environment,
        "HTTP_IDLE_TIMEOUT_SECONDS",
        900,
        30,
        86_400,
      ),
  };
}

export function activationDescriptor(
  environment = process.env,
  pid = process.pid,
) {
  const supplied = ["LISTEN_PID", "LISTEN_FDS", "LISTEN_FDNAMES"].some(
    (name) => environment[name] !== undefined,
  );
  if (!supplied) return undefined;
  if (
    environment.LISTEN_PID !== String(pid) ||
    environment.LISTEN_FDS !== "1" ||
    (environment.LISTEN_FDNAMES !== undefined &&
      environment.LISTEN_FDNAMES !== "http")
  )
    throw new Error("Invalid HTTP socket activation identity");
  if (!fstatSync(3).isSocket())
    throw new Error("HTTP activation descriptor is not a socket");
  return 3;
}

// The listener stays owned by systemd. Closing our duplicate releases the Node
// process while new connections remain queued for the next activation.
export function startHttpService(
  server,
  {
    port,
    name,
    environment = process.env,
    onListening = () => {},
    onIdle = () => {},
    busyUntil = () => 0,
    now = () => performance.now(),
    configuration = httpIdleConfiguration(environment),
  },
) {
  if (
    !(server instanceof Server) ||
    typeof configuration.enabled !== "boolean" ||
    !Number.isSafeInteger(configuration.timeoutMs) ||
    configuration.timeoutMs < 10 ||
    configuration.timeoutMs > 86_400_000
  )
    throw new Error("Invalid HTTP idle server configuration");
  let descriptor;
  try {
    descriptor = activationDescriptor(environment);
  } finally {
    for (const key of [
      "LISTEN_PID",
      "LISTEN_FDS",
      "LISTEN_FDNAMES",
      "LISTEN_PIDFDID",
    ])
      delete environment[key];
  }
  if (
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    !/^[a-z][a-z0-9_-]{0,63}$/.test(name)
  )
    throw new Error("Invalid HTTP service identity");
  const idle = descriptor !== undefined && configuration.enabled;
  let timer,
    active = 0,
    pending = 0,
    closing = false,
    lastCompleted = now();
  const sockets = new Map();
  function arm() {
    clearTimeout(timer);
    if (!idle || closing || active || pending) return;
    const lease = busyUntil();
    if (!Number.isFinite(lease) || lease < 0)
      throw new Error("Invalid HTTP activity lease");
    const remaining = Math.max(
      configuration.timeoutMs - (now() - lastCompleted),
      lease - Date.now(),
    );
    timer = setTimeout(
      () => {
        if (active || pending || closing) return;
        if (
          now() - lastCompleted < configuration.timeoutMs ||
          busyUntil() > Date.now()
        ) {
          arm();
          return;
        }
        closing = true;
        server.close(() => {
          Promise.resolve(onIdle())
            .then(() => {
              console.log(
                JSON.stringify({
                  event: "http_service.idle_exit",
                  service: name,
                }),
              );
            })
            .catch(() => {
              console.error(
                JSON.stringify({
                  event: "http_service.idle_cleanup_failed",
                  service: name,
                }),
              );
              process.exitCode = 1;
            });
        });
      },
      Math.max(1, Math.ceil(remaining)),
    );
    timer.unref();
  }
  // Fresh connections without a parsed HTTP request are not idle keep-alive.
  // Never close them in the acceptance/idle-deadline race.
  server.on("connection", (socket) => {
    const state = { seen: false };
    sockets.set(socket, state);
    pending++;
    clearTimeout(timer);
    socket.once("close", () => {
      sockets.delete(socket);
      if (!state.seen) pending--;
      arm();
    });
  });
  server.prependListener("request", (request, response) => {
    const passive =
      ["GET", "HEAD"].includes(request.method) &&
      ["/health", "/health/rendering"].includes(
        (request.url ?? "").split("?")[0],
      );
    // Readiness polling must not postpone sleep. Such responses explicitly
    // close their connection, avoiding a keep-alive reuse race at shutdown.
    if (passive) response.shouldKeepAlive = false;
    const state = sockets.get(request.socket);
    if (state && !state.seen) {
      state.seen = true;
      pending--;
    }
    active++;
    clearTimeout(timer);
    let completed = false,
      responseDone = false,
      requestDone = request.complete;
    const complete = () => {
      if (completed || !responseDone || !requestDone) return;
      completed = true;
      response.removeListener("finish", finishResponse);
      response.removeListener("close", finishResponse);
      request.removeListener("end", finishRequest);
      request.removeListener("close", finishRequest);
      active--;
      if (!passive) lastCompleted = now();
      arm();
    };
    const finishResponse = () => {
      responseDone = true;
      complete();
    };
    const finishRequest = () => {
      requestDone = true;
      complete();
    };
    response.once("finish", finishResponse);
    response.once("close", finishResponse);
    request.once("end", finishRequest);
    request.once("close", finishRequest);
  });
  server.once("close", () => clearTimeout(timer));
  const listening = () => {
    const address = server.address();
    if (
      !address ||
      typeof address === "string" ||
      address.address !== "127.0.0.1" ||
      address.port !== port
    ) {
      server.close();
      throw new Error("HTTP listener must match its loopback service endpoint");
    }
    // Idle keep-alive connections expire before the process idle deadline, so
    // the transport cannot retain a process forever or race that deadline.
    if (
      idle &&
      server.keepAliveTimeout + (server.keepAliveTimeoutBuffer ?? 0) >=
        configuration.timeoutMs
    ) {
      server.keepAliveTimeout = Math.max(
        1,
        Math.floor(configuration.timeoutMs / 2),
      );
      server.keepAliveTimeoutBuffer = 0;
    }
    if (environment.NOTIFY_SOCKET !== undefined)
      execFileSync("/usr/bin/systemd-notify", ["--ready"], {
        env: {
          PATH: "/usr/bin:/bin",
          NOTIFY_SOCKET: environment.NOTIFY_SOCKET,
        },
        timeout: 5000,
        stdio: "ignore",
      });
    lastCompleted = now();
    arm();
    onListening(address);
    console.log(
      JSON.stringify({
        event: "http_service.listening",
        service: name,
        activation: descriptor !== undefined,
        idleEnabled: idle,
        idleTimeoutSeconds: configuration.timeoutMs / 1000,
      }),
    );
  };
  if (descriptor === undefined) server.listen(port, "127.0.0.1", listening);
  else server.listen({ fd: descriptor }, listening);
  return server;
}
