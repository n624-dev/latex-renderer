export function baselineFailureIdentity(error: unknown): {
  codes: string[];
  certificate: string;
};
export function reportBaselineTransportFailure(error: unknown): Promise<void>;
