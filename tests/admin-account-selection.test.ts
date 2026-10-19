import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { part3 } from "../apps/admin-web/src/assets/admin-script-parts/part-3.js";
import { escapeHtml } from "../apps/admin-web/src/templates-shared.js";

it.each(["active", "disabled"])(
  "does not silently replace an explicitly requested %s account",
  async (status) => {
    const requested = "sa_second_page",
      calls: string[] = [];
    const context = {
      location: { search: `?account=${requested}` },
      URLSearchParams,
      request: (path: string) => {
        calls.push(path);
        return Promise.resolve(
          path === "/api-keys"
            ? { items: [] }
            : path === "/service-accounts"
              ? {
                  items: [
                    { id: "sa_first_page", name: "Other", status: "active" },
                  ],
                }
              : { id: requested, name: "Requested", status },
        );
      },
      out: { innerHTML: "" },
      section: (_title: string, html: string) => html,
      table: () => "",
      nextPage: () => "",
      esc: escapeHtml,
      document: { querySelector: () => ({ onclick: null }) },
      bindAction: () => {},
      sessionStorage: { getItem: () => null },
    };
    const result = runInNewContext(
      `${part3}\nkeys()`,
      context,
    ) as Promise<void>;
    if (status === "disabled")
      await expect(result).rejects.toThrow("別の対象へは切り替えません");
    else await expect(result).resolves.toBeUndefined();
    expect(calls).toEqual([
      "/api-keys",
      "/service-accounts",
      `/service-accounts/${requested}`,
    ]);
  },
);
