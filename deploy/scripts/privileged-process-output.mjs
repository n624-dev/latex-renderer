// Losing diagnostics is not permission to terminate only the sudo client of
// an independent mutating service. Always drain both pipes and await closure.
export async function waitPrivilegedProcess(child, append) {
  let logError,
    stderr = "";
  const closed = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  async function consume(stream, isError) {
    for await (const chunk of stream) {
      const value = String(chunk);
      if (isError) stderr = (stderr + value).slice(-8192);
      if (!logError) {
        try {
          await append(value);
        } catch (error) {
          logError = error;
        }
      }
    }
  }
  try {
    const [code] = await Promise.all([
      closed,
      consume(child.stdout, false),
      consume(child.stderr, true),
    ]);
    return { code, stderr, logError };
  } catch (error) {
    await closed.catch(() => {});
    throw error;
  }
}
