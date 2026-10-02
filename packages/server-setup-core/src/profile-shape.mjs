// Shared descriptor-first checks for secret-free review models.
export function profileRecord(value, label, allowed) {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw new Error(`${label} must be a plain object`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    Reflect.ownKeys(value).some(
      (key) => typeof key !== "string" || !allowed.includes(key),
    ) ||
    Object.values(descriptors).some(
      (descriptor) => !Object.hasOwn(descriptor, "value"),
    )
  )
    throw new Error(`${label} contains unsupported fields or accessors`);
  return value;
}

export function profileText(value, key, label) {
  if (!Object.hasOwn(value, key) || typeof value[key] !== "string")
    throw new Error(`${label} must be a string`);
  return value[key];
}
