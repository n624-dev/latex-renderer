import { describe, expect, it } from "vitest";
import {
  boundedIntegerEnvironment,
  loadResourceLimits,
  positiveBytesEnvironment,
  validPortEnvironment,
} from "@latex-renderer/shared";
import {
  boundedIntegerEnvironment as boundedScriptInteger,
  validPortEnvironment as validScriptPort,
} from "../deploy/scripts/environment.mjs";

describe("strict numeric environment parsing", () => {
  it.each(["NaN", "Infinity", "1.5", " 10", "10 ", "+10", "01", "-1", ""])(
    "rejects non-canonical integer %j",
    (raw) => {
      expect(() =>
        boundedIntegerEnvironment({ LIMIT: raw }, "LIMIT", 5, 0, 100),
      ).toThrow(/LIMIT/);
      expect(() =>
        boundedScriptInteger({ LIMIT: raw }, "LIMIT", 5, 0, 100),
      ).toThrow(/LIMIT/);
    },
  );

  it("enforces positive byte and port bounds and accepts defaults", () => {
    expect(positiveBytesEnvironment({}, "BYTES", 1024)).toBe(1024);
    expect(() => positiveBytesEnvironment({ BYTES: "0" }, "BYTES", 1)).toThrow(
      /BYTES/,
    );
    expect(validPortEnvironment({ PORT: "65535" }, "PORT", 3100)).toBe(
      65_535,
    );
    expect(validScriptPort({ PORT: "1" }, "PORT", 3100)).toBe(1);
    expect(() => validPortEnvironment({ PORT: "65536" }, "PORT", 3100)).toThrow(
      /PORT/,
    );
  });

  it("fails closed when a resource limit is malformed", () => {
    expect(() => loadResourceLimits({ MAX_FILE_COUNT: "not-a-number" })).toThrow(
      /MAX_FILE_COUNT/,
    );
    expect(() => loadResourceLimits({ MAX_UPLOAD_BYTES: "0" })).toThrow(
      /MAX_UPLOAD_BYTES/,
    );
  });
});
