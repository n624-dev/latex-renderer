import {
  parseEnvironmentFile,
  validateProfileValues,
} from "../scripts/validate-production-profile.mjs";

// Resolved only by the disposable runner's /etc/hosts; not a public DNS name.
export const ciHostname = "latex-renderer-ci.test";
export const ciCertificate =
  "/usr/local/share/ca-certificates/latex-renderer-ci.crt";
export const ciPrivateKey = "/etc/latex-renderer/ci/tls.key";

export function standaloneEnvironment(template) {
  const environment =
    template.replaceAll("latex.example.com", ciHostname) +
    `\nNODE_EXTRA_CA_CERTS=${ciCertificate}\n`;
  // Use the production boundary, not a CI exception for placeholder values.
  validateProfileValues(parseEnvironmentFile(environment));
  return environment;
}

export function standaloneProxy(template) {
  return template
    .replace(
      "/etc/letsencrypt/live/latex.example.com/fullchain.pem",
      ciCertificate,
    )
    .replace(
      "/etc/letsencrypt/live/latex.example.com/privkey.pem",
      ciPrivateKey,
    )
    .replaceAll("latex.example.com", ciHostname);
}

// The production dedicated ingress runs as the prepared API identity. The
// disposable historical-baseline proxy must use that same read boundary; a
// stock www-data worker cannot traverse sealed application release trees.
export function standaloneNginxIdentity(template) {
  if (!/^user\s+www-data\s*;$/m.test(template))
    throw new Error("Unexpected disposable Nginx worker identity");
  return template.replace(/^user\s+www-data\s*;$/m, "user latex-renderer;");
}
