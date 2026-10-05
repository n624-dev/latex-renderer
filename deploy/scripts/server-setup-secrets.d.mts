export type GeneratedServerSecret = "api-key-pepper" | "auth-password-pepper";
export class ServerSetupSecrets {
  constructor(
    root: string,
    rendererGid: number,
    uid?: number,
    rootGid?: number,
  );
  read(name: GeneratedServerSecret): Promise<Buffer>;
  recover(): Promise<{ removed: number }>;
  ensure(
    name: GeneratedServerSecret,
  ): Promise<{ slot: GeneratedServerSecret; status: "created" | "preserved" }>;
}
