import { createHash, createPublicKey } from "node:crypto";
import { join } from "node:path";
import { LanHttpsClientState } from "./client-state.mjs";
import { withLanHttpsProfile } from "./profiles.mjs";
import { createLanHttpsAcmeSession } from "./acme.mjs";

const fingerprint = (key) =>
  createHash("sha256")
    .update(createPublicKey(key).export({ type: "spki", format: "der" }))
    .digest("hex");

// Explicit administrative operation. It rolls over EXISTING CA accounts only:
// no createAccount, enrollment, EAB request or replacement account is possible.
// A lost keyChange response is resolved by POST-as-GET using the durable new
// key, never by generating yet another key or recreating an account.
export async function rotateLanHttpsAccountKeys(
  config,
  { clientFactory = createLanHttpsAcmeSession } = {},
) {
  return withLanHttpsProfile(
    config,
    async ({ rootState, groupState, state, id }) => {
      const index = JSON.parse(
        rootState.read("profiles.json", 32768).toString(),
      );
      const group = index.profiles.find((p) => p.id === id)?.group;
      if (!group) throw new Error("Missing authority profile group");
      const profiles = index.profiles
        .filter((p) => p.group === group)
        .map(
          (p) =>
            new LanHttpsClientState(
              join(config.stateDirectory, "profiles", p.id),
            ),
        );
      for (const profile of profiles) {
        const order = profile.read("order.json", 32768);
        if (order && JSON.parse(order.toString()).pending !== null)
          throw new Error(
            "Finish all pending authority orders before account rollover",
          );
      }
      const accounts = groupState.readAccounts();
      const issuers = Object.keys(accounts).sort();
      if (!issuers.length || issuers.length > 4)
        throw new Error("Saved CA accounts are required for key rollover");
      let record;
      const bytes = groupState.read("account-rotation.json", 32768);
      if (bytes) {
        try {
          record = JSON.parse(bytes.toString());
          if (
            record.format !== 1 ||
            !["pending", "done"].includes(record.phase) ||
            !/^[a-f0-9]{64}$/.test(record.oldKey) ||
            !/^[a-f0-9]{64}$/.test(record.newKey) ||
            record.oldKey === record.newKey ||
            JSON.stringify(record.accounts) !== JSON.stringify(accounts) ||
            !Array.isArray(record.completed) ||
            record.completed.length > 4 ||
            record.completed.some((issuer) => !issuers.includes(issuer)) ||
            new Set(record.completed).size !== record.completed.length
          )
            throw new Error();
        } catch {
          throw new Error(
            "Account rollover journal is invalid; restore matching state",
          );
        }
      }
      if (record?.phase === "done") {
        const previous = groupState.read("account-previous.pem", 16384);
        const pending = groupState.read("account-next.pem", 16384);
        if (
          record.completed.length !== issuers.length ||
          fingerprint(groupState.ensureAccountKey()) !== record.newKey ||
          !previous ||
          fingerprint(previous) !== record.oldKey ||
          (pending && fingerprint(pending) !== record.newKey)
        )
          throw new Error(
            "Completed account rollover does not match the saved keys; restore state",
          );
        groupState.finishAccountRotation();
        record = null;
      }
      const next = groupState.prepareAccountRotation();
      const current = groupState.ensureAccountKey();
      if (!record) {
        record = {
          format: 1,
          phase: "pending",
          oldKey: fingerprint(current),
          newKey: fingerprint(next),
          accounts,
          completed: [],
        };
        if (record.oldKey === record.newKey)
          throw new Error("Rollover keys must differ");
        groupState.saveProtocolRecord("account-rotation.json", record);
      }
      const old =
        fingerprint(current) === record.oldKey
          ? current
          : groupState.read("account-previous.pem", 16384);
      if (
        !old ||
        fingerprint(old) !== record.oldKey ||
        fingerprint(next) !== record.newKey ||
        ![record.oldKey, record.newKey].includes(fingerprint(current))
      )
        throw new Error("Account rollover keys do not match the journal");
      for (const issuer of issuers) {
        if (record.completed.includes(issuer)) continue;
        const candidate = await clientFactory({
          ...accounts[issuer],
          accountKey: next,
        });
        let confirmed = false;
        try {
          confirmed = (await candidate.updateAccount({})).status === "valid";
        } catch {
          /* Not yet rolled over, or a transient CA failure. */
        }
        if (!confirmed) {
          const previous = await clientFactory({
            ...accounts[issuer],
            accountKey: old,
          });
          await previous.updateAccountKey(next);
          if ((await candidate.updateAccount({})).status !== "valid")
            throw new Error(
              "CA did not confirm the existing account after key rollover",
            );
        }
        record.completed.push(issuer);
        groupState.saveProtocolRecord("account-rotation.json", record);
      }
      groupState.commitAccountRotation();
      for (const profile of profiles)
        profile.synchronizeAccountRotation(old, next);
      state.synchronizeAccountRotation(old, next);
      groupState.saveProtocolRecord("account-rotation.json", {
        ...record,
        phase: "done",
      });
      groupState.finishAccountRotation();
      return Object.freeze({ rotated: true, accounts: issuers.length });
    },
    { allowAccountRotation: true },
  );
}
