import { AppError } from "@latex-renderer/shared";

type ImageSelector = { mode?: string; value?: string | null };
type ApplyInput = {
  selector?: ImageSelector;
  languages?: string[];
  autoUpdate?: boolean;
  rebuildIfMissing?: boolean;
  [key: string]: unknown;
};
type ImagesResponse = { daily?: string[] };
type ManagerStateResponse = {
  desired?: {
    selector?: ImageSelector;
    languages?: string[];
    autoUpdate?: boolean;
  };
  current?: {
    selector?: ImageSelector | null;
    languages?: string[];
  } | null;
};

export class ImageManagerClient {
  private readonly endpoint: URL;

  constructor(
    baseUrl: string,
    private readonly token: string,
  ) {
    const endpoint = new URL(baseUrl);
    if (
      endpoint.protocol !== "http:" ||
      !["127.0.0.1", "::1", "localhost"].includes(endpoint.hostname) ||
      endpoint.username !== "" ||
      endpoint.password !== ""
    ) {
      throw new Error(
        "IMAGE_MANAGER_URL must be an unauthenticated loopback HTTP URL",
      );
    }
    if (token.length < 32) throw new Error("Image manager token is too short");
    this.endpoint = endpoint;
  }

  state(): Promise<unknown> {
    return this.request("GET", "/v1/state");
  }
  images(): Promise<unknown> {
    return this.request("GET", "/v1/images");
  }
  languages(): Promise<unknown> {
    return this.request("GET", "/v1/languages");
  }
  inventory(kind: "packages" | "fonts", query?: string): Promise<unknown> {
    const suffix = query ? `?q=${encodeURIComponent(query)}` : "";
    return this.request("GET", `/v1/inventory/${kind}${suffix}`);
  }
  operation(id: string): Promise<unknown> {
    if (!/^[A-Za-z0-9_-]+$/.test(id))
      throw new AppError(
        "INVALID_OPERATION_ID",
        "Invalid image operation id",
        400,
      );
    return this.request("GET", `/v1/operations/${encodeURIComponent(id)}`);
  }
  country(country: string | null): Promise<unknown> {
    return this.request("POST", "/v1/country", { country });
  }
  async apply(input: unknown): Promise<unknown> {
    if (typeof input !== "object" || input === null) {
      return this.request("POST", "/v1/apply", input);
    }
    const value: ApplyInput = { ...(input as ApplyInput) };
    if (
      value.selector?.mode === "date" &&
      typeof value.selector.value === "string" &&
      value.rebuildIfMissing !== false
    ) {
      let images: ImagesResponse;
      try {
        images = (await this.images()) as ImagesResponse;
      } catch {
        throw new AppError(
          "IMAGE_REGISTRY_UNAVAILABLE",
          "Could not determine whether the dated TeX image exists in GHCR; refusing to start a cold rebuild for a transient registry failure",
          503,
        );
      }
      const exists =
        Array.isArray(images.daily) &&
        images.daily.includes(value.selector.value);
      value.rebuildIfMissing = !exists;
    }
    return this.request("POST", "/v1/apply", value);
  }
  rollback(): Promise<unknown> {
    return this.request("POST", "/v1/rollback", {});
  }
  revalidate(): Promise<unknown> {
    return this.request("POST", "/v1/revalidate", {});
  }
  cleanup(): Promise<unknown> {
    return this.request("POST", "/v1/cleanup", {});
  }
  async refresh(): Promise<unknown> {
    const state = (await this.state()) as ManagerStateResponse;
    const desired = state.desired;
    const current = state.current;
    if (desired?.autoUpdate === true && desired.selector?.mode === "latest") {
      const desiredLanguages = normalizeLanguages(desired.languages);
      const currentLanguages = normalizeLanguages(current?.languages);
      const runtimeDrift =
        current?.selector?.mode !== "latest" ||
        desiredLanguages.length !== currentLanguages.length ||
        desiredLanguages.some(
          (language, index) => language !== currentLanguages[index],
        );
      if (runtimeDrift) {
        return this.apply({
          selector: { mode: "latest", value: null },
          languages: desiredLanguages,
          autoUpdate: true,
          rebuildIfMissing: false,
        });
      }
    }
    return this.request("POST", "/v1/refresh", {});
  }

  private async request(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(new URL(path, this.endpoint), {
        method,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${this.token}`,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new AppError(
        "IMAGE_MANAGER_UNAVAILABLE",
        "TeX image manager is unavailable",
        503,
      );
    }
    const value = (await response.json().catch(() => null)) as {
      error?: { code?: string; message?: string };
    } | null;
    if (!response.ok) {
      throw new AppError(
        value?.error?.code ?? "IMAGE_MANAGER_ERROR",
        value?.error?.message ??
          `Image manager returned HTTP ${response.status}`,
        response.status,
      );
    }
    return value;
  }
}

function normalizeLanguages(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").sort()
    : [];
}
