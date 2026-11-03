import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import unittest

spec = importlib.util.spec_from_file_location("image_archive_identity", Path(__file__).resolve().parents[1] / "deploy/ci/image_archive_identity.py")
identity = importlib.util.module_from_spec(spec)
spec.loader.exec_module(identity)


def blob(value):
    data = json.dumps(value, separators=(",", ":")).encode()
    return "sha256:" + hashlib.sha256(data).hexdigest(), data


def fixture(oci=True):
    config, config_bytes = blob({"architecture": "amd64", "os": "linux", "config": {"User": "10000"},
                                 "rootfs": {"type": "layers", "diff_ids": ["sha256:" + "a" * 64]}})
    manifest, manifest_bytes = blob({"config": {"digest": config}, "layers": []})
    index, index_bytes = blob({"manifests": [{"digest": manifest, "platform": {"architecture": "amd64", "os": "linux"}},
                                              {"digest": "sha256:" + "b" * 64, "platform": {"architecture": "unknown", "os": "unknown"}}]})
    entries = {"blobs/sha256/" + key[7:]: data for key, data in ((config, config_bytes), (manifest, manifest_bytes), (index, index_bytes))} if oci else {config[7:] + ".json": config_bytes}
    return index if oci else config, config, entries


def archive(entries):
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w") as output:
        for name, data in entries.items():
            entry = tarfile.TarInfo(name)
            entry.size = len(data)
            output.addfile(entry, io.BytesIO(data))
    return buffer.getvalue()


class ImageArchiveIdentity(unittest.TestCase):
    def test_legacy_config_and_containerd_index_resolve_to_exact_config(self):
        for oci in (False, True):
            with self.subTest(oci=oci):
                image, config, entries = fixture(oci)
                raw = archive(entries)
                relay = io.BytesIO()
                value = identity.relay_and_identify(io.BytesIO(raw), relay, image, "amd64", "linux")
                self.assertEqual(relay.getvalue(), raw)
                self.assertEqual(value["configDigest"], config)
                self.assertEqual(value["sourceIdKind"], "index" if oci else "config")
                self.assertTrue(value["descriptorChainVerified"])

    def test_rejects_corrupt_config_and_missing_descriptor(self):
        image, _, entries = fixture()
        first = next(iter(entries))
        entries[first] = entries[first].replace(b"10000", b"20000")
        with self.assertRaisesRegex(ValueError, "checksum"):
            identity.relay_and_identify(io.BytesIO(archive(entries)), io.BytesIO(), image, "amd64", "linux")
        _, _, entries = fixture()
        del entries[first]
        with self.assertRaisesRegex(ValueError, "missing"):
            identity.relay_and_identify(io.BytesIO(archive(entries)), io.BytesIO(), image, "amd64", "linux")

    def test_supports_an_oci_root_index_and_dot_prefixed_paths(self):
        image, config, entries = fixture()
        entries["index.json"] = entries.pop("blobs/sha256/" + image[7:])
        entries = {"./" + name: data for name, data in entries.items()}
        value = identity.relay_and_identify(io.BytesIO(archive(entries)), io.BytesIO(), image, "amd64", "linux")
        self.assertEqual(value["configDigest"], config)

    def test_rejects_unrelated_digest_and_wrong_platform(self):
        image, _, entries = fixture()
        raw = archive(entries)
        for expected, architecture in (("sha256:" + "c" * 64, "amd64"), (image, "arm64")):
            with self.assertRaises(ValueError):
                identity.relay_and_identify(io.BytesIO(raw), io.BytesIO(), expected, architecture, "linux")

    def test_cannot_substitute_two_distinct_matching_configs(self):
        image, config, entries = fixture()
        second, second_bytes = blob({"architecture": "amd64", "os": "linux", "rootfs": {"type": "layers", "diff_ids": ["sha256:" + "d" * 64]}})
        root, root_bytes = blob({"manifests": [{"digest": config}, {"digest": second}]})
        entries["blobs/sha256/" + second[7:]] = second_bytes
        entries["blobs/sha256/" + root[7:]] = root_bytes
        with self.assertRaisesRegex(ValueError, "exactly one"):
            identity.relay_and_identify(io.BytesIO(archive(entries)), io.BytesIO(), root, "amd64", "linux")

    def test_streams_large_blobs_and_rejects_corruption(self):
        image, _, entries = fixture()
        data = b"binary layer\0" * 100000
        name = "blobs/sha256/" + hashlib.sha256(data).hexdigest()
        entries[name] = data
        raw = archive(entries)
        relay = io.BytesIO()
        identity.relay_and_identify(io.BytesIO(raw), relay, image, "amd64", "linux")
        self.assertEqual(relay.getvalue(), raw)
        entries[name] = data[:-1] + b"x"
        with self.assertRaisesRegex(ValueError, "checksum"):
            identity.relay_and_identify(io.BytesIO(archive(entries)), io.BytesIO(), image, "amd64", "linux")


if __name__ == "__main__":
    unittest.main()
