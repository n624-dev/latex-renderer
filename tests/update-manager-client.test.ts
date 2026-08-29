import { describe, expect, it } from "vitest";
import { updateManagerTransportError } from "../apps/admin-api/src/services/update-manager.js";

describe("Update Manager transport diagnostics", () => {
  it.each([
    ["ENOENT", "UPDATE_MANAGER_SOCKET_MISSING", 503],
    ["EACCES", "UPDATE_MANAGER_SOCKET_FORBIDDEN", 503],
    ["ECONNREFUSED", "UPDATE_MANAGER_NOT_LISTENING", 503],
    ["ETIMEDOUT", "UPDATE_MANAGER_TIMEOUT", 504],
    ["ECONNRESET", "UPDATE_MANAGER_CONNECTION_LOST", 503],
    ["UNKNOWN", "UPDATE_MANAGER_UNAVAILABLE", 503],
  ])(
    "maps %s without exposing the underlying path or message",
    (transport, code, status) => {
      const error = updateManagerTransportError({
        code: transport,
        message: "sensitive host path",
        path: "/private/config",
      });
      expect(error.code).toBe(code);
      expect(error.status).toBe(status);
      expect(error.message).not.toContain("sensitive");
      expect(error.message).not.toContain("/private/config");
    },
  );
});
