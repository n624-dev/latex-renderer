import { request as httpRequest } from "node:http";
import { AppError } from "@latex-renderer/shared";

export function updateManagerTransportError(error: unknown): AppError {
  const rawCode = typeof error === "object" && error !== null && "code" in error
    ? (error as { code?: unknown }).code
    : "";
  const transportCode = typeof rawCode === "string" ? rawCode : "";
  switch (transportCode) {
    case "ENOENT":
      return new AppError("UPDATE_MANAGER_SOCKET_MISSING", "Application Update Manager socket is unavailable", 503);
    case "EACCES":
      return new AppError("UPDATE_MANAGER_SOCKET_FORBIDDEN", "Admin API cannot access the Application Update Manager socket", 503);
    case "ECONNREFUSED":
      return new AppError("UPDATE_MANAGER_NOT_LISTENING", "Application Update Manager is not accepting connections", 503);
    case "ETIMEDOUT":
      return new AppError("UPDATE_MANAGER_TIMEOUT", "Application Update Manager request timed out", 504);
    case "ECONNRESET":
      return new AppError("UPDATE_MANAGER_CONNECTION_LOST", "Application Update Manager connection closed during the request", 503);
    default:
      return new AppError("UPDATE_MANAGER_UNAVAILABLE", "Application Update Manager is unavailable", 503);
  }
}

export class UpdateManagerClient {
  constructor(
    private readonly socketPath: string,
    private readonly token: string,
  ) {
    if (!socketPath.startsWith("/run/latex-renderer/") || !socketPath.endsWith(".sock")) {
      throw new Error("UPDATE_MANAGER_SOCKET must be below /run/latex-renderer");
    }
    if (token.length < 32) throw new Error("Update Manager token is too short");
  }

  state(): Promise<unknown> { return this.request("GET", "/v1/state"); }
  check(version?: string): Promise<unknown> { return this.request("POST", "/v1/check", version ? { version } : {}); }
  policy(mode: "notify" | "automatic"): Promise<unknown> { return this.request("POST", "/v1/policy", { channel: "stable", mode }); }
  refresh(): Promise<unknown> { return this.request("POST", "/v1/refresh", {}); }
  apply(version?: string): Promise<unknown> { return this.request("POST", "/v1/apply", version ? { version } : {}); }
  rollback(): Promise<unknown> { return this.request("POST", "/v1/rollback", {}); }
  operation(id: string): Promise<unknown> {
    if (!/^updop_[A-Za-z0-9_-]+$/.test(id)) throw new AppError("INVALID_OPERATION_ID", "Invalid update operation id", 400);
    return this.request("GET", `/v1/operations/${encodeURIComponent(id)}`);
  }

  private request(method: "GET" | "POST", path: string, body?: unknown): Promise<unknown> {
    const serialized = body === undefined ? undefined : JSON.stringify(body);
    return new Promise((resolve, reject) => {
      const request = httpRequest({
        socketPath: this.socketPath,
        path,
        method,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${this.token}`,
          ...(serialized === undefined ? {} : {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(serialized),
          }),
        },
        timeout: 30_000,
      });
      request.on("timeout", () => request.destroy(Object.assign(new Error("Update Manager request timed out"), { code: "ETIMEDOUT" })));
      request.on("error", (error) => reject(updateManagerTransportError(error)));
      request.on("response", (response) => {
        let size = 0;
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > 256 * 1024) response.destroy(new Error("Update Manager response is too large"));
          else chunks.push(chunk);
        });
        response.on("error", (error) => reject(updateManagerTransportError(error)));
        response.on("end", () => {
          let value: unknown;
          try { value = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
          catch { return reject(new AppError("UPDATE_MANAGER_INVALID_RESPONSE", "Application Update Manager returned invalid JSON", 502)); }
          if ((response.statusCode ?? 500) >= 400) {
            const error = typeof value === "object" && value !== null && "error" in value
              ? (value as { error?: { code?: string; message?: string } }).error
              : undefined;
            return reject(new AppError(error?.code ?? "UPDATE_MANAGER_ERROR", error?.message ?? "Application update failed", response.statusCode ?? 500));
          }
          resolve(value);
        });
      });
      if (serialized !== undefined) request.write(serialized);
      request.end();
    });
  }
}
