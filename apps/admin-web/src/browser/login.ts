import { safeLoginReturnTo } from "@latex-renderer/shared/login-redirect";
import { normalizeBrowserLoginConfiguration } from "../assets/auth-configuration.js";
import { siteCopy } from "./site-copy.js";

async function installLogin(): Promise<void> {
  const methods = document.querySelector("#login-methods");
  const message = document.querySelector("#login-message");
  if (!methods || !message) return;
  const text = siteCopy();
  const target = safeLoginReturnTo(
    new URLSearchParams(location.search).get("return_to") ?? "/app/",
  );
  const get = { credentials: "same-origin", cache: "no-store" } as const;
  const showError = (error: unknown) => {
    message.textContent =
      error instanceof Error ? error.message : String(error);
  };

  const request = async (
    url: string,
    init: RequestInit = get,
  ): Promise<unknown> => {
    const response = await fetch(url, init);
    const data = await response.text();
    let body: { error?: { message?: unknown } } | null;
    try {
      body = data ? (JSON.parse(data) as typeof body) : {};
    } catch {
      throw new Error(
        text("invalidResponse", "サーバーから不正な応答が返されました。"),
      );
    }
    if (!response.ok) {
      const description = body?.error?.message;
      throw new Error(
        typeof description === "string" && description
          ? description
          : text("signInError", "ログインできませんでした。"),
      );
    }
    return body;
  };

  function externalButton(label: string): HTMLButtonElement {
    const button = document.createElement("button");
    button.id = "external-login";
    button.type = "button";
    button.textContent = label;
    return button;
  }

  try {
    const config = normalizeBrowserLoginConfiguration(
      await request("/auth/config"),
    );
    message.textContent = "";
    if (config.backend === "cloudflare-access") {
      const button = externalButton(
        text("cloudflareLogin", "Cloudflare Accessで続行"),
      );
      button.onclick = () => {
        if (button.disabled) return;
        button.disabled = true;
        message.textContent = "";
        void request("/auth/session")
          .then(() => location.replace(target))
          .catch((error: unknown) => {
            showError(error);
            button.disabled = false;
          });
      };
      methods.append(button);
      return;
    }

    if (config.methods.some((method) => method.id === "password")) {
      const form = document.createElement("form");
      form.id = "password-login";
      form.className = "stack";
      const field = (label: string, settings: Partial<HTMLInputElement>) => {
        const wrapper = document.createElement("label");
        const caption = document.createElement("span");
        caption.textContent = label;
        const input = document.createElement("input");
        Object.assign(input, settings);
        input.required = true;
        wrapper.append(caption, input);
        form.append(wrapper);
        return input;
      };
      const loginName = field(text("loginName", "ログイン名"), {
        name: "loginName",
        autocomplete: "username",
        minLength: 3,
        maxLength: 64,
      });
      const password = field(text("password", "パスワード"), {
        name: "password",
        type: "password",
        autocomplete: "current-password",
        minLength: 12,
        maxLength: 1024,
      });
      const submit = document.createElement("button");
      submit.type = "submit";
      submit.textContent = text("signIn", "ログイン");
      form.append(submit);
      form.onsubmit = (event) => {
        event.preventDefault();
        if (submit.disabled) return;
        message.textContent = "";
        submit.disabled = true;
        void request("/auth/password/login", {
          ...get,
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            loginName: loginName.value,
            password: password.value,
          }),
        })
          .then(() => {
            password.value = "";
            location.replace(target);
          })
          .catch((error: unknown) => {
            showError(error);
            submit.disabled = false;
          });
      };
      methods.append(form);
      loginName.focus();
    }
    const oidc = config.methods.find((method) => method.id === "oidc");
    if (oidc) {
      if (methods.childElementCount) {
        const separator = document.createElement("p");
        separator.textContent = text("or", "または");
        methods.append(separator);
      }
      const label = text("providerLogin", "{provider}でログイン").replace(
        "{provider}",
        () => oidc.displayName,
      );
      const button = externalButton(label);
      button.onclick = () =>
        location.assign(
          "/auth/oidc/start?return_to=" + encodeURIComponent(target),
        );
      methods.append(button);
    }
  } catch (error) {
    methods.replaceChildren();
    showError(error);
  }
}

void installLogin();
