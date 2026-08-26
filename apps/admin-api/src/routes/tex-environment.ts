import { Hono } from "hono";
import { z } from "zod";
import { AppError } from "@latex-renderer/shared";
import { requireActor } from "../auth/actor.js";
import type { AdminActor, AdminDependencies } from "../types.js";
import { parse } from "./helpers.js";

const countrySchema = z.string().regex(/^[A-Z]{2}$/);
const languageSchema = z.string().regex(/^collection-lang[A-Za-z0-9._-]+$/);
const weeklySchema = z.string().regex(/^\d{4}-W(?:0[1-9]|[1-4]\d|5[0-3])$/);
const selectorSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("latest"), value: z.null().optional() }),
  z.object({ mode: z.literal("date"), value: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
  z.object({ mode: z.literal("weekly"), value: weeklySchema }),
  z.object({ mode: z.literal("digest"), value: z.string().regex(/^sha256:[a-f0-9]{64}$/) }),
]);
const applySchema = z
  .object({
    selector: selectorSchema,
    languages: z.array(languageSchema).max(100),
    autoUpdate: z.boolean(),
    rebuildIfMissing: z.boolean().default(true),
  })
  .superRefine((value, context) => {
    if (value.autoUpdate && value.selector.mode !== "latest") {
      context.addIssue({ code: "custom", path: ["autoUpdate"], message: "autoUpdate is only available with the latest selector" });
    }
  });

type ManagerState = {
  desired?: { countryOverride?: string | null; languages?: string[] };
  activeOperationId?: string | null;
};
type LanguageItem = { id: string; name: string; description?: string };
type LanguageResponse = { items: LanguageItem[] };
type OperationResponse = { id?: string; type?: string; status?: string };

const EN = "collection-langenglish";
const EUROPEAN = "collection-langeuropean";
const OTHER = "collection-langother";
const countryLanguages: Readonly<Record<string, readonly string[]>> = {
  JP: ["collection-langjapanese"], KR: ["collection-langkorean"], CN: ["collection-langchinese"], TW: ["collection-langchinese"], HK: ["collection-langchinese"], MO: ["collection-langchinese"],
  GB: [EN], US: [EN], AU: [EN], NZ: [EN], IE: [EN], CA: [EN, "collection-langfrench"], SG: [EN], PH: [EN], ZA: [EN], NG: [EN], GH: [EN], KE: [EN], UG: [EN],
  FR: ["collection-langfrench"], MC: ["collection-langfrench"], BE: [EUROPEAN, "collection-langfrench", "collection-langgerman"], CH: ["collection-langgerman", "collection-langfrench", "collection-langitalian"], LU: ["collection-langfrench", "collection-langgerman"],
  SN: ["collection-langfrench"], CI: ["collection-langfrench"], ML: ["collection-langfrench"], NE: ["collection-langfrench"], BF: ["collection-langfrench"], TG: ["collection-langfrench"], BJ: ["collection-langfrench"], GN: ["collection-langfrench"], GA: ["collection-langfrench"], CG: ["collection-langfrench"], CD: ["collection-langfrench"], CM: ["collection-langfrench", EN], TD: ["collection-langfrench", "collection-langarabic"], CF: ["collection-langfrench"], DJ: ["collection-langfrench", "collection-langarabic"], MG: ["collection-langfrench"], HT: ["collection-langfrench"],
  DE: ["collection-langgerman"], AT: ["collection-langgerman"], LI: ["collection-langgerman"], IT: ["collection-langitalian"], SM: ["collection-langitalian"], VA: ["collection-langitalian"],
  ES: ["collection-langspanish"], MX: ["collection-langspanish"], AR: ["collection-langspanish"], CL: ["collection-langspanish"], CO: ["collection-langspanish"], PE: ["collection-langspanish"], VE: ["collection-langspanish"], EC: ["collection-langspanish"], BO: ["collection-langspanish"], PY: ["collection-langspanish"], UY: ["collection-langspanish"], CR: ["collection-langspanish"], PA: ["collection-langspanish"], GT: ["collection-langspanish"], HN: ["collection-langspanish"], SV: ["collection-langspanish"], NI: ["collection-langspanish"], DO: ["collection-langspanish"], CU: ["collection-langspanish"], GQ: ["collection-langspanish"],
  PT: ["collection-langportuguese"], BR: ["collection-langportuguese"], AO: ["collection-langportuguese"], MZ: ["collection-langportuguese"], CV: ["collection-langportuguese"], GW: ["collection-langportuguese"], ST: ["collection-langportuguese"], TL: ["collection-langportuguese"],
  PL: ["collection-langpolish"], CZ: ["collection-langczechslovak"], SK: ["collection-langczechslovak"], GR: ["collection-langgreek"], CY: ["collection-langgreek"],
  RU: ["collection-langcyrillic"], UA: ["collection-langcyrillic"], BG: ["collection-langcyrillic"], RS: ["collection-langcyrillic", EUROPEAN], BY: ["collection-langcyrillic"], MK: ["collection-langcyrillic"], KZ: ["collection-langcyrillic"], KG: ["collection-langcyrillic"], TJ: ["collection-langcyrillic"], MN: ["collection-langcyrillic"],
  SA: ["collection-langarabic"], AE: ["collection-langarabic"], EG: ["collection-langarabic"], QA: ["collection-langarabic"], KW: ["collection-langarabic"], JO: ["collection-langarabic"], IQ: ["collection-langarabic"], SY: ["collection-langarabic"], LB: ["collection-langarabic"], YE: ["collection-langarabic"], OM: ["collection-langarabic"], BH: ["collection-langarabic"], MA: ["collection-langarabic", "collection-langfrench"], DZ: ["collection-langarabic", "collection-langfrench"], TN: ["collection-langarabic", "collection-langfrench"], LY: ["collection-langarabic"], SD: ["collection-langarabic"], PS: ["collection-langarabic"],
  NL: [EUROPEAN], DK: [EUROPEAN], NO: [EUROPEAN], SE: [EUROPEAN], FI: [EUROPEAN], IS: [EUROPEAN], HU: [EUROPEAN], RO: [EUROPEAN], HR: [EUROPEAN], SI: [EUROPEAN], EE: [EUROPEAN], LV: [EUROPEAN], LT: [EUROPEAN], AL: [EUROPEAN], BA: [EUROPEAN], ME: [EUROPEAN], MT: [EUROPEAN, EN],
  IL: [OTHER], IN: [OTHER, EN], PK: [OTHER, EN], BD: [OTHER], NP: [OTHER], LK: [OTHER], TH: [OTHER], VN: [OTHER], KH: [OTHER], LA: [OTHER], MM: [OTHER], ID: [OTHER], MY: [OTHER, EN], GE: [OTHER], AM: [OTHER], IR: [OTHER], AF: [OTHER], ET: [OTHER], ER: [OTHER],
};

export function createTexEnvironmentRouter(deps: AdminDependencies): Hono {
  const r = new Hono();
  let mutationGate: Promise<void> = Promise.resolve();
  const manager = () => {
    if (!deps.imageManager) throw new AppError("IMAGE_MANAGER_UNAVAILABLE", "TeX image manager is not configured", 503);
    return deps.imageManager;
  };
  const serializeMutation = async <T>(task: () => Promise<T>): Promise<T> => {
    const previous = mutationGate;
    let release!: () => void;
    mutationGate = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try { return await task(); } finally { release(); }
  };

  r.get("/state", async (c) => {
    await requireActor(deps, c, "admin:system:read");
    return c.json(await manager().state());
  });
  r.get("/images", async (c) => {
    await requireActor(deps, c, "admin:system:read");
    const imageManager = manager();
    try {
      return c.json(await imageManager.images());
    } catch (error) {
      if (error instanceof AppError && (error.code === "IMAGE_MANAGER_UNAVAILABLE" || error.status < 500)) throw error;
      return c.json({ repository: null, latest: false, daily: [], weekly: [], registryUnavailable: true });
    }
  });
  r.get("/languages", async (c) => {
    await requireActor(deps, c, "admin:system:read");
    const imageManager = manager();
    const state = (await imageManager.state()) as ManagerState;
    let catalog: LanguageResponse;
    let catalogUnavailable = false;
    try {
      catalog = (await imageManager.languages()) as LanguageResponse;
    } catch {
      catalogUnavailable = true;
      catalog = { items: [...new Set(state.desired?.languages ?? [])].map((id) => ({ id, name: id.replace(/^collection-lang/, "") })) };
    }
    const headerCountry = normalizeCountry(c.req.header("CF-IPCountry"));
    const override = normalizeCountry(state.desired?.countryOverride ?? undefined);
    const effectiveCountry = override ?? headerCountry;
    const available = new Set(catalog.items.map((item) => item.id));
    const preferred = [...(effectiveCountry ? (countryLanguages[effectiveCountry] ?? []) : []), EN]
      .filter((id, index, values) => available.has(id) && values.indexOf(id) === index);
    const rank = new Map(preferred.map((id, index) => [id, index]));
    const items = [...catalog.items]
      .map((item) => ({ ...item, recommended: rank.has(item.id), selected: state.desired?.languages?.includes(item.id) ?? false }))
      .sort((a, b) => {
        const ar = rank.get(a.id), br = rank.get(b.id);
        if (ar !== undefined || br !== undefined) return (ar ?? Number.MAX_SAFE_INTEGER) - (br ?? Number.MAX_SAFE_INTEGER);
        return languageLabel(a).localeCompare(languageLabel(b), "en");
      });
    return c.json({ detectedCountry: headerCountry, countryOverride: override, effectiveCountry: effectiveCountry ?? null, catalogUnavailable, items });
  });
  r.post("/country", async (c) => {
    const actor = await requireActor(deps, c, "admin:system:write");
    const input = parse(z.object({ country: countrySchema.nullable() }), await c.req.json<unknown>());
    const imageManager = manager();
    const result = await serializeMutation(async () => {
      const currentState = (await imageManager.state()) as ManagerState;
      if (currentState.activeOperationId)
        throw new AppError("IMAGE_OPERATION_ACTIVE", "Country override cannot change while a TeX image operation is running", 409);
      return imageManager.country(input.country);
    });
    audit(deps, actor, "tex_environment.country_updated", "country", "success", { country: input.country });
    return c.json(result);
  });
  r.get("/inventory/:kind", async (c) => {
    await requireActor(deps, c, "admin:system:read");
    const kind = parse(z.enum(["packages", "fonts"]), c.req.param("kind"));
    const query = c.req.query("q")?.slice(0, 200);
    return c.json(await manager().inventory(kind, query));
  });
  r.get("/operations/:id", async (c) => {
    await requireActor(deps, c, "admin:system:read");
    return c.json(await manager().operation(c.req.param("id")));
  });
  r.post("/apply", async (c) => {
    const actor = await requireActor(deps, c, "admin:system:write");
    const input = parse(applySchema, await c.req.json<unknown>());
    // The exact selected TeX Live snapshot is authoritative for collection existence.
    const result = (await serializeMutation(() => manager().apply(input))) as OperationResponse;
    audit(deps, actor, "tex_environment.apply_requested", result.id ?? "apply", "requested", {
      selector: input.selector, languages: input.languages, autoUpdate: input.autoUpdate, rebuildIfMissing: input.rebuildIfMissing,
    });
    return c.json(result, 202);
  });
  for (const action of ["rollback", "revalidate", "cleanup", "refresh"] as const) {
    r.post(`/${action}`, async (c) => {
      const actor = await requireActor(deps, c, "admin:system:write");
      const result = (await serializeMutation(() => manager()[action]())) as OperationResponse;
      audit(deps, actor, `tex_environment.${action}_requested`, result.id ?? action, "requested", {});
      return c.json(result, 202);
    });
  }
  return r;
}

function audit(
  deps: AdminDependencies,
  actor: AdminActor,
  action: string,
  targetId: string,
  result: "success" | "requested",
  metadata: Record<string, unknown>,
): void {
  deps.database.audit({ actorType: actor.type, actorId: actor.id, action, targetType: "tex_environment", targetId, result, metadata });
}
function normalizeCountry(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const country = value.trim().toUpperCase();
  return countrySchema.safeParse(country).success ? country : undefined;
}
function languageLabel(item: LanguageItem): string {
  return item.description?.trim() || item.name || item.id;
}
