export function boundedIntegerEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number;
export function positiveIntegerEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
  name: string,
  fallback: number,
  maximum?: number,
): number;
export function positiveBytesEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
  name: string,
  fallback: number,
  maximum?: number,
): number;
export function positiveDurationEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
  name: string,
  fallback: number,
  maximum?: number,
): number;
export function validPortEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
  name: string,
  fallback: number,
): number;
