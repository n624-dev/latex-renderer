# Threat model

Assets are API/ticket signing secrets, account authority, source documents, generated artifacts, audit history, host integrity, and availability. Adversaries include malicious API clients, compromised AI tools, hostile TeX/ZIP/PDF/image authors, unauthorized administrators, and Internet attackers.

Primary boundaries are Cloudflare edge -> Tunnel -> loopback APIs, API process -> SQLite/storage, worker -> Docker daemon, and hostile job -> sandbox. Principal threats are credential replay, ticket reuse after disablement, ZIP traversal/bombs, TeX/Lua code execution, Docker/host escape, resource exhaustion, cross-job file access, XSS/terminal injection from logs, unsafe state races, and audit/backup tampering.

Controls include scoped/versioned credentials, per-request subject revalidation, nonce/idempotency transactions, server-generated paths, streamed limits, strict ZIP header/path checks, rootless hardened containers, output type/magic/size revalidation, text-only DOM rendering, bounded CLI/MCP output, append-only audit APIs, and encrypted off-host exports. Residual risk remains in the Docker/kernel, TeX, image/PDF parser, Cloudflare, and administrator supply chains; patching, digest review, monitoring, and restore drills are required.
