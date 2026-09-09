// These values are per-user, not machine-wide defaults. Hosted images can put
// runner paths in /etc/environment, which PAM reapplies after sudo/runuser.
export const userEnvironmentKeys = Object.freeze([
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
  "XDG_RUNTIME_DIR",
  "DOCKER_CONFIG",
  "DOCKER_HOST",
  "DOCKER_CONTEXT",
]);

export function withoutUserEnvironmentDefaults(text) {
  return text
    .split(/(?<=\n)/)
    .filter((line) => {
      const key = line.match(/^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=/)?.[1];
      return !userEnvironmentKeys.includes(key);
    })
    .join("");
}
