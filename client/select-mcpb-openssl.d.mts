export const WINDOWS_OPENSSL_VERSION: "3.6.4";
export function selectRunnerOpenSSL(
  programFiles: string | undefined,
  run?: (executable: string, args: string[]) => string,
): { directory: string; executable: string; version: string };
