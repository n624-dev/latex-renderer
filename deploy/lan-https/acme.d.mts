import type { Client, Authorization, Order } from "acme-client";
import type * as AcmeTypes from "acme-client/types/rfc8555.js";
import type { LanHttpsAuthorityClient } from "./authority-client.mjs";
import type { LanHttpsIssuanceJournal } from "./order-journal.mjs";
export interface LanHttpsCertificateValidationInput {
  certificate: string;
  privateKey: Buffer | string;
  hostnames: readonly string[];
  now?: number;
  trustedCertificates?: readonly string[];
}
export function createLanHttpsAcmeSession(options: {
  directoryUrl: string;
  accountKey: Buffer | string;
  accountUrl?: string;
}): Promise<Client>;
export function createLanHttpsCertificateRequest(options: {
  provider: unknown;
  installationId: string;
  privateKey: Buffer | string;
}): Promise<Readonly<{ csr: Buffer; hostnames: readonly string[] }>>;
export function validateLanHttpsIssuedCertificate(
  options: LanHttpsCertificateValidationInput,
): Promise<Readonly<{ fingerprint256: string; expiresAt: string }>>;
export class LanHttpsIssuanceError extends Error {
  readonly cleanupPending: readonly string[];
  readonly retryAt: number | null;
  readonly orderTerminal: boolean;
  constructor(
    cleanupPending: readonly string[],
    retryAt?: number | null,
    orderTerminal?: boolean,
  );
}
export interface LanHttpsAcmeDriver {
  getAccountUrl(): string;
  createAccount(data: AcmeTypes.AccountCreateRequest): Promise<unknown>;
  createOrder(
    data: AcmeTypes.OrderCreateRequest & { replaces?: string },
  ): Promise<Order>;
  getOrder(order: Order): Promise<Order>;
  getAuthorizations(order: Order): Promise<Authorization[]>;
  getChallengeKeyAuthorization(challenge: AcmeTypes.Challenge): Promise<string>;
  verifyChallenge(
    authz: Authorization,
    challenge: AcmeTypes.Challenge,
  ): Promise<boolean | void>;
  completeChallenge(challenge: AcmeTypes.Challenge): Promise<unknown>;
  waitForValidStatus<T extends Order | Authorization | AcmeTypes.Challenge>(
    value: T,
  ): Promise<T>;
  finalizeOrder(order: Order, csr: Buffer): Promise<Order>;
  getCertificate(order: Order): Promise<string>;
}
export function issueLanHttpsCertificate(options: {
  provider: unknown;
  authority: Pick<
    LanHttpsAuthorityClient,
    | "installationId"
    | "bindAcmeAccount"
    | "presentChallenge"
    | "removeChallenge"
  >;
  client: LanHttpsAcmeDriver;
  issuerId: string;
  accountKey: Buffer | string;
  tlsKey: Buffer | string;
  termsAccepted: boolean;
  saveAccount: (url: string) => Promise<void>;
  replaces?: string;
  journal?: LanHttpsIssuanceJournal;
  now?: () => number;
  verifyCertificate?: typeof validateLanHttpsIssuedCertificate;
}): Promise<
  Readonly<{
    certificate: string;
    accountUrl: string;
    fingerprint256: string;
    expiresAt: string;
    cleanupPending: readonly string[];
  }>
>;
