"""Relay a Docker export unchanged and resolve its verified OCI config digest."""
import argparse
import hashlib
import json
import os
import re
import sys
import tarfile

DIGEST = re.compile(r"sha256:[0-9a-f]{64}\Z")
MEMBER = re.compile(r"(?:blobs/sha256/)?([0-9a-f]{64})(?:\.json)?\Z")


def relay_and_identify(source, destination, expected, architecture, system):
    if not DIGEST.fullmatch(expected):
        raise ValueError("Expected a full immutable source image digest")
    blobs = {}
    metadata_bytes = 0

    class Relay:
        def read(self, size):
            data = source.read(size)
            destination.write(data)
            return data

    relay = Relay()
    with tarfile.open(fileobj=relay, mode="r|", bufsize=64 * 1024) as archive:
        for count, entry in enumerate(archive):
            if count >= 10000:
                raise ValueError("Image export member budget exceeded")
            match = MEMBER.fullmatch(entry.name)
            if not match or not entry.isfile():
                continue
            stream = archive.extractfile(entry)
            checksum = hashlib.sha256()
            chunks = [] if entry.size <= 1024 * 1024 else None
            while chunk := stream.read(64 * 1024):
                checksum.update(chunk)
                if chunks is not None:
                    chunks.append(chunk)
            if checksum.hexdigest() != match[1]:
                raise ValueError("Image export metadata/blob checksum mismatch")
            if chunks is None:
                continue
            data = b"".join(chunks)
            try:
                value = json.loads(data)
            except (UnicodeError, ValueError):
                continue  # Small binary layers are not OCI metadata.
            if not isinstance(value, dict):
                continue
            digest = "sha256:" + match[1]
            metadata_bytes += len(data)
            if metadata_bytes > 8 * 1024 * 1024:
                raise ValueError("Image export metadata budget exceeded")
            blobs[digest] = value
    # tarfile may stop before final padding. Preserve the complete input stream.
    while data := relay.read(64 * 1024):
        pass
    destination.flush()

    def resolve(digest, depth=0):
        if depth > 8 or not isinstance(digest, str) or not DIGEST.fullmatch(digest):
            raise ValueError("Invalid image descriptor chain")
        value = blobs.get(digest)
        if value is None:
            raise ValueError("Referenced image metadata is missing")
        if "manifests" in value:
            manifests = value["manifests"]
            if not isinstance(manifests, list) or len(manifests) > 128:
                raise ValueError("Invalid image index")
            found = set()
            for item in manifests:
                platform = item.get("platform")
                if platform and (platform.get("architecture") != architecture or platform.get("os") != system):
                    continue
                found.update(resolve(item.get("digest"), depth + 1))
            return found
        if "config" in value and "rootfs" not in value:
            return resolve(value["config"].get("digest"), depth + 1)
        if value.get("architecture") != architecture or value.get("os") != system:
            return set()
        rootfs = value.get("rootfs", {})
        layers = rootfs.get("diff_ids")
        if rootfs.get("type") != "layers" or not isinstance(layers, list) or not layers or len(layers) > 256:
            raise ValueError("Invalid image root filesystem identity")
        if not all(isinstance(layer, str) and DIGEST.fullmatch(layer) for layer in layers):
            raise ValueError("Invalid image layer identity")
        return {digest}

    selected = resolve(expected)
    if len(selected) != 1:
        raise ValueError("Export does not select exactly one requested platform config")
    root = blobs[expected]
    kind = "config" if "rootfs" in root else "index" if "manifests" in root else "manifest"
    return {"schemaVersion": 1, "sourceImageId": expected, "sourceIdKind": kind, "configDigest": selected.pop(),
            "architecture": architecture, "os": system, "descriptorChainVerified": True}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output")
    parser.add_argument("image")
    parser.add_argument("architecture", choices=("amd64", "arm64"))
    parser.add_argument("system", choices=("linux",))
    args = parser.parse_args()
    os.umask(0o077)
    value = relay_and_identify(sys.stdin.buffer, sys.stdout.buffer, args.image, args.architecture, args.system)
    descriptor = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, "w") as stream:
        json.dump(value, stream)


if __name__ == "__main__":
    main()
