import { describe, expect, it } from "vitest";
import {
  eligibleManagedImage,
  imageCleanupPolicy,
} from "../deploy/scripts/image-cleanup-policy.mjs";

describe("managed image cleanup", () => {
  const now = Date.parse("2026-09-05T00:00:00Z");
  const image = {
    Id: "sha256:managed",
    Created: "2026-09-01T00:00:00Z",
    Config: {
      Labels: {
        "jp.n624.latex-renderer.base-image-id": "sha256:base",
        "jp.n624.latex-renderer.renderer-runtime-fingerprint": "fingerprint",
      },
    },
  };
  it("always preserves current, rollback and configured image IDs", () => {
    expect(eligibleManagedImage(image, new Set([image.Id]), 0, now)).toBe(
      false,
    );
    expect(eligibleManagedImage(image, new Set(), 24, now)).toBe(true);
  });
  it("preserves recent, unknown and unrelated images", () => {
    expect(
      eligibleManagedImage(
        { ...image, Created: new Date(now).toISOString() },
        new Set(),
        24,
        now,
      ),
    ).toBe(false);
    expect(
      eligibleManagedImage({ ...image, Created: "invalid" }, new Set(), 0, now),
    ).toBe(false);
    expect(
      eligibleManagedImage({ ...image, Config: {} }, new Set(), 0, now),
    ).toBe(false);
  });
  it("defaults to daily cleanup and a two-GiB unused cache budget", () => {
    expect(imageCleanupPolicy({})).toEqual({
      intervalHours: 24,
      retentionHours: 24,
      cacheMaxGiB: 2,
    });
    expect(
      imageCleanupPolicy({ IMAGE_CLEANUP_INTERVAL_HOURS: "0" }).intervalHours,
    ).toBe(0);
    for (const value of ["-1", "1.5", " 24", "99999"]) {
      expect(() =>
        imageCleanupPolicy({ IMAGE_CLEANUP_INTERVAL_HOURS: value }),
      ).toThrow();
    }
  });
});
