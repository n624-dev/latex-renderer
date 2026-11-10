// A single producer hands over already verified file descriptors. Keep them
// open until their data/metadata sync finishes, and drain every peer on error.
export class DurableFileBatch {
  constructor(limit = 4) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 4)
      throw new Error(
        "File durability batch must contain between 1 and 4 files",
      );
    this.limit = limit;
    this.pending = [];
  }

  async add(handle) {
    this.pending.push(handle);
    if (this.pending.length >= this.limit) await this.flush();
  }

  async flush() {
    const files = this.pending.splice(0);
    const outcomes = await Promise.allSettled(
      files.map(async (handle) => {
        let failed = false,
          failure;
        try {
          await handle.sync();
        } catch (error) {
          failed = true;
          failure = error;
        }
        try {
          await handle.close();
        } catch (error) {
          if (!failed) {
            failed = true;
            failure = error;
          }
        }
        if (failed) throw failure;
      }),
    );
    const failed = outcomes.find((result) => result.status === "rejected");
    if (failed) throw failed.reason;
  }

  // Only used while unwinding a failed tree walk. No successful publication
  // can reach this with pending data: flush() precedes the completion receipt.
  async discard() {
    await Promise.allSettled(
      this.pending.splice(0).map((handle) => handle.close()),
    );
  }
}
