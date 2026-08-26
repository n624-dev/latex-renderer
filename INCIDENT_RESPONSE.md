# Incident response

1. Set maintenance to `lockdown`, stop Admin Web and renderer worker, and preserve journals/DB snapshots without exposing document contents.
2. For a key leak, revoke the API key. For account compromise, disable its service account or user to invalidate existing tickets immediately.
3. For signing-key compromise, insert a `kid` revocation covering its maximum ticket lifetime, activate a new random key/KID, restart ticket issuers/verifiers, then remove the old key after expiry.
4. For pepper compromise, revoke keys, rotate the active pepper ID, and reissue keys; hashes cannot safely be re-peppered without plaintext.
5. For sandbox concern, stop workers and Docker containers, preserve image digest and metadata, rotate host secrets if exposure is plausible, patch, rebuild, and re-run security tests before resuming.
6. Export immutable audit evidence, document scope/timeline, notify affected owners, and perform recovery from a verified backup if integrity is uncertain.
