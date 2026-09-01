export function boundedIntegerEnvironment(
  environment,
  name,
  fallback,
  minimum,
  maximum,
) {
  if (
    !Number.isSafeInteger(fallback) ||
    !Number.isSafeInteger(minimum) ||
    !Number.isSafeInteger(maximum) ||
    minimum > maximum ||
    fallback < minimum ||
    fallback > maximum
  )
    throw new Error(`${name} integer environment schema is invalid`);
  const raw = environment[name];
  if (raw === undefined) return fallback;
  if (!/^(?:0|[1-9][0-9]*)$/.test(raw))
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  return value;
}

export function positiveIntegerEnvironment(
  environment,
  name,
  fallback,
  maximum = Number.MAX_SAFE_INTEGER,
) {
  return boundedIntegerEnvironment(environment, name, fallback, 1, maximum);
}

export function positiveBytesEnvironment(
  environment,
  name,
  fallback,
  maximum = Number.MAX_SAFE_INTEGER,
) {
  return positiveIntegerEnvironment(environment, name, fallback, maximum);
}

export function positiveDurationEnvironment(
  environment,
  name,
  fallback,
  maximum = Number.MAX_SAFE_INTEGER,
) {
  return positiveIntegerEnvironment(environment, name, fallback, maximum);
}

export function validPortEnvironment(environment, name, fallback) {
  return boundedIntegerEnvironment(environment, name, fallback, 1, 65_535);
}
