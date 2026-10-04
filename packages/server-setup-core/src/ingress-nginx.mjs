import { validateServerIngressReview } from "./ingress-review.mjs";
import { URL } from "node:url";

export const SERVER_INGRESS_TLS_PATHS = Object.freeze({
  certificate: "/etc/latex-renderer/secrets/https-cert.pem",
  privateKey: "/etc/latex-renderer/secrets/https-key.pem",
});

// Only validated values enter this fixed http-context template. No arbitrary
// directives, file paths, upstreams or provider configuration are accepted.
export function renderServerIngressNginx(input) {
  const review = validateServerIngressReview(input);
  if (review.mode !== "standalone" || review.tlsProvider !== "custom")
    throw new Error("Nginx rendering requires standalone/custom ingress");
  const origin = new URL(review.publicOrigin);
  const hostname = origin.hostname;
  // URL allows unusual DNS spellings; restrict the configuration grammar.
  if (!/^(?:[a-z0-9.-]+|\[[0-9a-f:]+\])$/i.test(hostname))
    throw new Error("Ingress hostname cannot be represented safely in Nginx");
  const address = review.listenAddress.includes(":")
    ? `[${review.listenAddress}]`
    : review.listenAddress;
  const networks =
    review.accessScope === "internet"
      ? ["0.0.0.0/0", "::/0"]
      : review.accessScope === "local"
        ? ["127.0.0.0/8", "::1/128"]
        : review.allowedNetworks;
  // Realip may be enabled in the enclosing http context. ACLs and downstream
  // identity use the original socket peer, never a caller-supplied header.
  return `# Generated standalone ingress; include ONCE from the http context.
# Requires ngx_http_realip_module; no HTTP listener or provider calls.
geo $realip_remote_addr $latex_renderer_ingress_allowed {
  default 0;
${networks.map((network) => `  ${network} 1;`).join("\n")}
}
limit_conn_zone $realip_remote_addr zone=latex_renderer_connections:10m;
limit_req_zone $realip_remote_addr zone=latex_renderer_login:10m rate=5r/m;
limit_req_zone $realip_remote_addr zone=latex_renderer_api:10m rate=120r/m;

server {
  listen ${address}:${origin.port || 443} ssl http2;
  server_name ${hostname};
  ssl_certificate ${SERVER_INGRESS_TLS_PATHS.certificate};
  ssl_certificate_key ${SERVER_INGRESS_TLS_PATHS.privateKey};
  ssl_protocols TLSv1.2 TLSv1.3;
  if ($latex_renderer_ingress_allowed = 0) { return 403; }
  if ($host != ${hostname}) { return 421; }
  add_header Strict-Transport-Security "max-age=63072000" always;
  client_max_body_size 220m;
  client_body_timeout 60s;
  client_header_timeout 20s;
  keepalive_timeout 30s;
  send_timeout 360s;
  limit_conn latex_renderer_connections 20;
  limit_conn_status 429;
  limit_req_status 429;
  proxy_set_header Host ${origin.host};
  proxy_set_header X-Forwarded-Proto https;
  proxy_set_header X-Forwarded-Host ${origin.host};
  proxy_set_header X-Forwarded-For $realip_remote_addr;
  proxy_set_header X-Real-IP $realip_remote_addr;
  proxy_set_header Forwarded "";
  proxy_set_header X-Latex-Renderer-Client-IP $realip_remote_addr;
  proxy_set_header CF-Access-Jwt-Assertion "";
  proxy_set_header CF-Connecting-IP "";
  proxy_redirect off;
  proxy_connect_timeout 5s;
  proxy_send_timeout 120s;
  proxy_read_timeout 360s;
${GATEWAY_ROUTES.map((route) => `  location ${route} { limit_req zone=latex_renderer_api burst=20 nodelay; proxy_pass http://127.0.0.1:3105; }`).join("\n")}
  location ~ ^/\\.well-known/oauth-(authorization-server|protected-resource) { proxy_pass http://127.0.0.1:3104; }
  location ~ ^/(oauth|mcp)(/|$) { proxy_pass http://127.0.0.1:3104; }
  location = /auth/password/login { limit_req zone=latex_renderer_login burst=5 nodelay; proxy_pass http://127.0.0.1:3102; }
  location ~ ^/(auth|admin/api|admin/v1|app/api)(/|$) { proxy_pass http://127.0.0.1:3102; }
  location ^~ /api/ { proxy_pass http://127.0.0.1:3100; }
  location / { proxy_pass http://127.0.0.1:3101; }
}
`;
}

const GATEWAY_ROUTES = [
  "= /api/v1/health",
  "= /api/v1/render-tickets",
  "= /api/v1/source-tickets",
  "^~ /api/v1/job-tickets/",
  "= /api/v1/projects",
  "^~ /api/v1/projects/",
];
