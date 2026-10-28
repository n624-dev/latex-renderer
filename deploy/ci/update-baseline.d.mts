type Baseline = { source: string; version: string; commit: string };
export function updateBaselineTag(
  variant: string,
  architecture: string,
): string;
export function acquireUpdateBaseline(
  options: {
    variant: string;
    architecture: string;
    stage: string;
    apiToken: string | undefined;
    run: (command: string, args: string[]) => unknown;
  },
  dependencies?: {
    download?: (
      tag: string,
      stage: string,
      options: { apiToken: string },
    ) => Promise<Baseline>;
    activateHttps?: (
      run: (command: string, args: string[]) => unknown,
    ) => Promise<void>;
    reportFailure?: (error: unknown) => Promise<void>;
  },
): Promise<{ baseline: Baseline; baselineTag: string }>;
