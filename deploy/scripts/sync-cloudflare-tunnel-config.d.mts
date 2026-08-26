export interface TunnelIngressRule {
  hostname?: string;
  path?: string;
  service: string;
  originRequest?: Record<string, unknown>;
}

export function hostnameFromOrigin(origin: string): string;
export function desiredLatexRoutes(hostname: string): TunnelIngressRule[];
export function reconcileLatexRoutes(
  ingress: TunnelIngressRule[],
  options: { hostname: string; legacyHostnames?: string[] },
): TunnelIngressRule[];
