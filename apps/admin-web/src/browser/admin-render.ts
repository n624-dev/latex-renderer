import {
  installRenderWorkflow,
  responseError,
} from "../assets/render-script.js";
import type { AdminMessage } from "../admin-messages.js";

async function startRenderPage(
  catalog: Readonly<Record<AdminMessage, string>>,
): Promise<void> {
  const response = await fetch("/auth/session", {
    credentials: "same-origin",
    cache: "no-store",
  });
  if (response.status === 401) {
    location.replace(
      `/login/?return_to=${encodeURIComponent(location.pathname + location.search)}`,
    );
    return;
  }
  if (!response.ok) throw await responseError(response);
  const session: unknown = await response.json();
  if (
    typeof session !== "object" ||
    session === null ||
    !("csrfToken" in session) ||
    typeof session.csrfToken !== "string"
  )
    throw new Error(catalog.couldNotSignIn);
  installRenderWorkflow(session.csrfToken, (key) => catalog[key]);
}

export function installAdminRender(
  catalog: Readonly<Record<AdminMessage, string>>,
): void {
  void startRenderPage(catalog).catch((error: unknown) => {
    const output = document.querySelector("#render-error");
    if (output)
      output.textContent =
        error instanceof Error ? error.message : String(error);
  });
}
