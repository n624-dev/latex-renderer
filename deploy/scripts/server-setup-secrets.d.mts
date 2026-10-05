export type GeneratedServerSecret =
  | "api-key-pepper"
  | "auth-password-pepper"
  | "image-manager-token"
  | "update-manager-token"
  | "v1.key";
export class ServerSetupSecrets {
  constructor(
    root: string,
    rendererGid: number,
    uid?: number,
    rootGid?: number,
    allowServiceDirectory?: boolean,
  );
  read(name: GeneratedServerSecret): Promise<Buffer>;
  directory(): Promise<void>;
  recover(): Promise<{ removed: number }>;
  ensure(
    name: GeneratedServerSecret,
  ): Promise<{ slot: GeneratedServerSecret; status: "created" | "preserved" }>;
}
