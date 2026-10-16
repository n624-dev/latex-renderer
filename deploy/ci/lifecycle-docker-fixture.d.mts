export interface DockerFixtureAdapter {
  runDocker(args: readonly string[], timeoutMs: number): Promise<string>;
  dockerStopVerified(name: string): Promise<void>;
}
export function runDockerFixture(
  args: readonly string[],
  docker: DockerFixtureAdapter,
): Promise<void>;
