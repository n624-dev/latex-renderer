import { request as httpRequest } from "node:http";
import { AppError } from "@latex-renderer/shared";

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
      request.on("timeout", () => request.destroy(new Error("Update Manager request timed out")));
      request.on("error", () => reject(new AppError("UPDATE_MANAGER_UNAVAILABLE", "Application Update Manager is unavailable", 503)));
      request.on("response", (response) => {
        let size = 0;
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > 256 * 1024) response.destroy(new Error("Update Manager response is too large"));
          else chunks.push(chunk);
        });
        response.on("error", () => reject(new AppError("UPDATE_MANAGER_UNAVAILABLE", "Application Update Manager returned an invalid response", 503)));
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
