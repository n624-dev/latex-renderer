export function createUpdateManagerState<T extends object>(
  initial: T,
  write: (next: T & { updatedAt: string }) => Promise<void>,
  now?: () => Date,
): {
  readonly current: T;
  update(
    change: Partial<T> | ((current: Readonly<T>) => Partial<T>),
  ): Promise<T & { updatedAt: string }>;
};
