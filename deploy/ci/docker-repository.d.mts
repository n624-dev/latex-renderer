export function configureDockerRepository(
  run: (program: string, args: string[]) => unknown,
  architecture?: string,
): Promise<void>;
