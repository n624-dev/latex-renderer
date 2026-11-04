import { randomInt } from "node:crypto";
import { profileRecord } from "../../packages/server-setup-core/src/profile-shape.mjs";

function time(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= 8640000000000000;
}
function checked(value, context) {
  profileRecord(value, "saved renewal schedule", [
    "format",
    "context",
    "fingerprint256",
    "renewAt",
    "ari",
    "certificateId",
    "attempt",
    "nextAttemptAt",
    "updatedAt",
  ]);
  if (
    value.format !== 1 ||
    value.context !== context ||
    !(
      value.fingerprint256 === null ||
      (typeof value.fingerprint256 === "string" &&
        /^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(value.fingerprint256))
    ) ||
    !time(value.renewAt) ||
    typeof value.ari !== "boolean" ||
    !(
      value.certificateId === null ||
      (typeof value.certificateId === "string" &&
        value.certificateId.length <= 1024 &&
        /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value.certificateId))
    ) ||
    (value.ari && value.certificateId === null) ||
    !Number.isSafeInteger(value.attempt) ||
    value.attempt < 0 ||
    value.attempt > 16 ||
    !(value.nextAttemptAt === null || time(value.nextAttemptAt)) ||
    !time(value.updatedAt)
  )
    throw new Error("Invalid saved LAN HTTPS renewal schedule");
  return Object.freeze({ ...value });
}

export class LanHttpsRenewalJournal {
  #state;
  #context;
  #random;
  constructor({ state, context, random = randomInt }) {
    if (typeof context !== "string" || !/^[a-f0-9]{64}$/.test(context))
      throw new Error("Invalid renewal context");
    this.#state = state;
    this.#context = context;
    this.#random = random;
  }
  read() {
    const bytes = this.#state.read("renewal.json", 32768);
    if (!bytes) return null;
    try {
      return checked(JSON.parse(bytes.toString("utf8")), this.#context);
    } catch {
      throw new Error(
        "Saved renewal schedule is invalid or belongs to different settings; state was retained",
      );
    }
  }
  #save(value) {
    const record = checked(value, this.#context);
    this.#state.saveProtocolRecord("renewal.json", record);
    return record;
  }
  plan({ fingerprint256, renewAt, ari = false, certificateId = null, now }) {
    this.read();
    return this.#save({
      format: 1,
      context: this.#context,
      fingerprint256,
      renewAt,
      ari,
      certificateId,
      attempt: 0,
      nextAttemptAt: null,
      updatedAt: now,
    });
  }
  due(now) {
    if (!time(now)) throw new Error("Invalid renewal clock");
    const current = this.read();
    if (!current) return true;
    if (current.updatedAt > now + 300000)
      throw new Error("LAN HTTPS renewal clock moved backwards");
    return now >= (current.nextAttemptAt ?? current.renewAt);
  }
  begin(now) {
    // Persist before contacting external services. Repeated crashes/restarts do
    // not bypass retry timing; the next timer invocation resumes the same order.
    const current = this.read();
    if (!current || !this.due(now))
      throw new Error("LAN HTTPS renewal is not due");
    return this.#save({
      ...current,
      nextAttemptAt: now + 600000,
      updatedAt: now,
    });
  }
  failed(now, retryAt = null) {
    const current = this.read();
    if (!current || !time(now) || !(retryAt === null || time(retryAt)))
      throw new Error("Invalid renewal retry");
    const attempt = Math.min(16, current.attempt + 1);
    const delay = Math.min(21600000, 60000 * 2 ** (attempt - 1));
    const jitter = this.#random(60001);
    if (!Number.isSafeInteger(jitter) || jitter < 0 || jitter > 60000)
      throw new Error("Invalid renewal jitter");
    return this.#save({
      ...current,
      attempt,
      updatedAt: now,
      nextAttemptAt: Math.max(now + delay + jitter, retryAt ?? 0),
    });
  }
}
