export function createUpdateManagerState(initial, write, now = () => new Date()) {
  let current = initial;
  let pending = Promise.resolve();

  return {
    get current() {
      return current;
    },
    update(change) {
      const commit = pending.then(async () => {
        const patch = typeof change === "function" ? change(current) : change;
        const next = { ...current, ...patch, updatedAt: now().toISOString() };
        await write(next);
        current = next;
        return next;
      });
      pending = commit.then(() => {}, () => {});
      return commit;
    },
  };
}
