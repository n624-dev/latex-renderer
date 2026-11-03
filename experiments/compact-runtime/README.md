# Can the existing renderer run without an engine daemon?

This opt-in experiment for #282 exercises a fixed synthetic document with the local rootless **Podman CLI**. It does not use `podman system service`, change a systemd unit, migrate images, open a production database, or switch the supported Docker backend. Run it only on a disposable Linux host under a dedicated unprivileged test account, not on the production renderer. Do not run this probe on user-supplied images or documents.

## Run

Prerequisites: local rootless Podman, cgroup v2 with delegated CPU/memory/PID limits, GNU `timeout`, and an already-imported **trusted final renderer image** containing `/opt/renderer/compile.sh` (not the language-neutral base). Use the full `sha256:` local **image ID**, not a tag or a registry manifest digest. Podman must be able to read the checked-out `deploy/security/seccomp.json`. Do not weaken confinement to make the test pass.

```sh
# From the repository root; substitute the verified full local image ID.
sh experiments/compact-runtime/probe.sh 'sha256:<64 lowercase hex digits>'

# Host control-flow tests with a fake engine; not an integration test.
python3 experiments/compact-runtime/test_probe.py -v
```

The probe forbids pulling, uses a single read-only synthetic input mount and a bounded tmpfs for output, and checks effective UID/GID, capability masks, seccomp filter mode, no-new-privileges, loopback-only interfaces, read-only mounts and cgroup limits before invoking the image's compile script. The final PDF must pass `qpdf --check` and contain the expected text. The probe uses a bounded runtime and verifies that its named container no longer exists. A cleanup error is not a successful run. No archive, source or PDF is retained.

## What a pass does not prove

This is one PDF smoke test, not support for a production backend. It does not test production bind-mount ACLs, SVG or previews, lease recovery, image management, all host security profiles, memory savings, or cold-start latency. A daemonless CLI is not evidence of zero auxiliary processes: measure the whole test user's cgroup, including any rootless namespace helper. Keep production Docker and sandbox policies unchanged pending evidence.

For the decision in #282, run the same pinned image and input on comparable hosts/configurations. Record idle process lists and PSS/cgroup memory before first use, after 15 minutes and across an hour; separate ingress and operating-system costs. Record first PDF latency and warm latency without counting image pulls. Report unsupported hosts or failed policy checks, not just successful results. Re-test with the production worker/ACLs, cancellation and recovery before selecting a backend.
