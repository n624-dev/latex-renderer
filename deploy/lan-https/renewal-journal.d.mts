import type { LanHttpsClientState } from "./client-state.mjs";
export interface LanHttpsRenewalRecord {
  readonly format: 1;
  readonly context: string;
  readonly fingerprint256: string | null;
  readonly renewAt: number;
  readonly ari: boolean;
  readonly certificateId: string | null;
  readonly attempt: number;
  readonly nextAttemptAt: number | null;
  readonly updatedAt: number;
}
export class LanHttpsRenewalJournal {
  constructor(options: {
    state: LanHttpsClientState;
    context: string;
    random?: (max: number) => number;
  });
  read(): Readonly<LanHttpsRenewalRecord> | null;
  plan(options: {
    fingerprint256: string | null;
    renewAt: number;
    ari?: boolean;
    certificateId?: string | null;
    now: number;
  }): Readonly<LanHttpsRenewalRecord>;
  due(now: number): boolean;
  begin(now: number): Readonly<LanHttpsRenewalRecord>;
  failed(now: number, retryAt?: number | null): Readonly<LanHttpsRenewalRecord>;
}
