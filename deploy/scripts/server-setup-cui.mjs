import {
  SERVER_RUNTIME_LIMITS,
  createServerSetupSession,
} from "../../packages/server-setup-core/src/index.mjs";

/** IO is a frontend adapter only. No filesystem, shell, provider or secret
 * operations live here; the exact same session is used by the Web frontend.
 */
export async function runServerSetupCui(host, io) {
  const session = createServerSetupSession(host);
  try {
    const { review } = await session.status();
    let candidate = JSON.parse(JSON.stringify(review));
    io.print(
      "Existing prepared host only. No OS, user, Docker, disk, owner, key or ingress changes. Blank input retains a value.",
    );
    io.print(
      `Public origin: ${candidate.deployment.authentication.deployment.publicOrigin}`,
    );
    const memoryFields = [
      "minimumAvailableMemoryBytes",
      "maximumMemoryBytes",
      "maximumSwapBytes",
    ];
    /** @type {Record<string,string>} */
    const memoryLabels = {
      minimumAvailableMemoryBytes: "開始に必要な空きRAM",
      maximumMemoryBytes: "実行RAMの上限",
      maximumSwapBytes: "追加swapの上限（0は無効）",
    };
    for (const [name, [, , maximum, minimum = 1]] of Object.entries(
      SERVER_RUNTIME_LIMITS,
    )) {
      const activeMaximum = name === "jobTimeoutSeconds" ? 840 : maximum;
      const scale = memoryFields.includes(name) ? 1024 ** 2 : 1;
      const value = await io.ask(
        `${memoryLabels[name] ?? name}${scale > 1 ? " (MiB)" : ""} [${candidate.runtime.limits[name] / scale}${activeMaximum && activeMaximum < Number.MAX_SAFE_INTEGER ? `; max ${activeMaximum / scale}` : ""}]: `,
      );
      if (value.trim()) {
        const parsed = Number(value.trim()) * scale;
        if (
          !/^[0-9]+(?:\.[0-9]+)?$/.test(value.trim()) ||
          !Number.isSafeInteger(parsed) ||
          parsed < minimum
        )
          throw new Error("Invalid bounded integer");
        candidate.runtime.limits[name] = parsed;
      }
    }
    const authentication = candidate.deployment.authentication.authentication;
    if (authentication.backend === "native") {
      const selected = await io.ask(
        "Login methods [blank keeps current; password / oidc / both]: ",
      );
      if (selected.trim()) {
        if (!["password", "oidc", "both"].includes(selected.trim()))
          throw new Error("Invalid login methods");
        const passwordEnabled = selected.trim() !== "oidc",
          oidcEnabled = selected.trim() !== "password";
        let oidc;
        if (oidcEnabled) {
          const existing = authentication.oidcEnabled
            ? authentication.oidc
            : null;
          const issuer =
            (
              await io.ask(
                `OIDC HTTPS issuer [${existing?.issuer ?? "required"}]: `,
              )
            ).trim() || existing?.issuer;
          const clientId =
            (
              await io.ask(
                `OIDC client ID [${existing?.clientId ?? "required"}]: `,
              )
            ).trim() || existing?.clientId;
          const displayName =
            (
              await io.ask(
                `OIDC display name [${existing?.displayName ?? "OIDC"}]: `,
              )
            ).trim() ||
            existing?.displayName ||
            "OIDC";
          oidc = {
            issuer,
            clientId,
            displayName,
            allowedAlgorithms: existing?.allowedAlgorithms ?? ["RS256"],
          };
        }
        candidate.deployment.authentication.authentication = {
          backend: "native",
          passwordEnabled,
          oidcEnabled,
          ...(oidcEnabled ? { oidc } : {}),
        };
      }
    }
    // The Web frontend has an advanced format-4 editor. Keep an equivalent
    // inline CUI path so uncommon reviewed fields/backends are not Web-only.
    const advanced = await io.ask(
      "Optional full format-4 JSON on one line (no secrets; blank keeps the fields above): ",
    );
    if (advanced.trim()) candidate = JSON.parse(advanced);
    const checked = await session.preview(candidate);
    for (const name of memoryFields)
      io.print(
        `${memoryLabels[name]}: ${checked.review.runtime.limits[name] / 1024 ** 2} MiB`,
      );
    io.print(JSON.stringify(checked.review, null, 2));
    io.print(
      "Apply stops the fixed service set, validates existing credentials/owner and recovers failures. No credentials are collected here.",
    );
    if (
      (await io.ask("Type APPLY to apply; anything else cancels: ")) !== "APPLY"
    ) {
      io.print("Cancelled; no settings applied.");
      return { applied: false };
    }
    await session.apply(checked.confirmation);
    io.print("Applied. Verify owner login and a representative render.");
    return { applied: true };
  } finally {
    session.close();
  }
}
