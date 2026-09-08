#!/usr/bin/env python3
"""Capacity-bounded, immutable TeX Live subset snapshot manager.

The production sync path deliberately delegates TLS to curl and signature
verification to gpgv.  Files are selected from the signed, unmodified tlpdb;
the database itself is never rewritten.
"""

from __future__ import annotations

import argparse
import contextlib
import dataclasses
import datetime as dt
import fcntl
import hashlib
import json
import os
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import urllib.parse
from pathlib import Path, PurePosixPath
from typing import Any, Iterator


GIB = 1_073_741_824
ID_RE = re.compile(
    r"^tl(?P<year>20\d\d)-(?P<db>[0-9a-f]{16})-(?P<installer>[0-9a-f]{16})-(?P<selection>[0-9a-f]{16})-v(?P<version>[1-9][0-9]*)$"
)
OWNER_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,199}$")
PACKAGE_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9+_.-]*$")
REVISION_RE = re.compile(r"^(?:0|[1-9][0-9]{0,15})$")
ARCHES = {"amd64": "x86_64-linux", "arm64": "aarch64-linux"}
STATE_SCHEMA = 1
MIRROR_FORMAT = 2


class MirrorError(RuntimeError):
    exit_code = 1


class ConfigError(MirrorError):
    exit_code = 64


class VerificationError(MirrorError):
    exit_code = 65


class StateError(MirrorError):
    exit_code = 74


class CapacityBlocked(MirrorError):
    exit_code = 75


def utcnow() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def iso(value: dt.datetime) -> str:
    return value.astimezone(dt.timezone.utc).isoformat().replace("+00:00", "Z")


def parse_time(value: str) -> dt.datetime:
    if not isinstance(value, str):
        raise StateError("timestamp must be a string")
    try:
        parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise StateError(f"invalid timestamp: {value!r}") from error
    if parsed.tzinfo is None:
        raise StateError("timestamp has no timezone")
    return parsed.astimezone(dt.timezone.utc)


def sha512_file(path: Path) -> str:
    digest = hashlib.sha512()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def canonical_json(value: Any) -> bytes:
    return (
        json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
        + "\n"
    ).encode()


def atomic_json(path: Path, value: Any, mode: int = 0o600) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        os.fchmod(fd, mode)
        with os.fdopen(fd, "wb") as stream:
            stream.write(canonical_json(value))
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        directory_fd = os.open(path.parent, os.O_DIRECTORY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    except BaseException:
        with contextlib.suppress(FileNotFoundError):
            os.unlink(temporary)
        raise


def read_json(path: Path) -> Any:
    try:
        with path.open("rb") as stream:
            value = json.load(stream)
    except (OSError, ValueError) as error:
        raise StateError(f"cannot safely read {path}: {error}") from error
    return value


@dataclasses.dataclass(frozen=True)
class Config:
    root: Path
    public_base_url: str
    upstream_base_url: str
    active_year: int
    architectures: tuple[str, ...]
    profile: Path
    keyring: Path
    hard_limit: int
    gc_start: int
    gc_target: int
    sync_peak_limit: int
    os_free_min: int
    keep_generations: int
    keep_hours: int
    sync_timeout: int
    reservation_ttl: int
    max_reserved_snapshots: int
    stale_update_hours: int
    metadata_headroom: int
    temp_multiplier_milli: int
    hard_limit_enforcement: str
    notify_command: tuple[str, ...]
    latest_lookback_days: int
    validation_collections: tuple[str, ...]
    ci_job_timeout: int
    sync_enabled: bool

    @classmethod
    def load(cls, path: Path) -> "Config":
        raw = read_json(path)
        if not isinstance(raw, dict):
            raise ConfigError("configuration must be a JSON object")

        def integer(name: str, default: int, minimum: int = 0) -> int:
            value = raw.get(name, default)
            if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
                raise ConfigError(f"{name} must be an integer >= {minimum}")
            return value

        def gib(name: str, default: int) -> int:
            return integer(name, default, 1) * GIB

        root = Path(raw.get("root", "/srv/texlive-ci"))
        if not root.is_absolute() or root == Path("/"):
            raise ConfigError("root must be an absolute, non-root path")
        year = integer("active_year", 2026, 2000)
        if year > 2100:
            raise ConfigError("active_year is outside the supported range")
        architectures = tuple(raw.get("architectures", ["amd64"]))
        if (
            not architectures
            or len(set(architectures)) != len(architectures)
            or any(a not in ARCHES for a in architectures)
        ):
            raise ConfigError(
                "architectures must be a unique, non-empty subset of amd64 and arm64"
            )
        hard, start, target, peak = (
            gib("hard_limit_gib", 15),
            gib("gc_start_gib", 11),
            gib("gc_target_gib", 9),
            gib("sync_peak_limit_gib", 14),
        )
        if not target < start < peak < hard:
            raise ConfigError(
                "capacity ordering must be gc_target < gc_start < sync_peak_limit < hard_limit"
            )
        ttl_hours = integer("reservation_ttl_hours", 8, 1)
        if ttl_hours > 8:
            raise ConfigError("reservation_ttl_hours must not exceed 8")
        ttl = ttl_hours * 3600
        sync_timeout = integer("sync_timeout_minutes", 180, 1) * 60
        ci_job_timeout = integer("ci_job_timeout_minutes", 360, 1) * 60
        if ttl <= max(sync_timeout, ci_job_timeout):
            raise ConfigError(
                "reservation TTL must be longer than the sync and CI job timeouts"
            )
        public_url = str(raw.get("public_base_url", ""))
        upstream_url = str(
            raw.get("upstream_base_url", "https://texlive.info/tlnet-archive")
        )
        for name, value in (
            ("public_base_url", public_url),
            ("upstream_base_url", upstream_url),
        ):
            parsed = urllib.parse.urlparse(value)
            if (
                parsed.scheme != "https"
                or not parsed.netloc
                or parsed.query
                or parsed.fragment
            ):
                raise ConfigError(
                    f"{name} must be an https URL without query or fragment"
                )
        notify = raw.get("notify_command", [])
        validation_collections = tuple(
            raw.get(
                "validation_collections",
                ["collection-langenglish", "collection-langjapanese"],
            )
        )
        if not isinstance(notify, list) or not all(
            isinstance(v, str) and v for v in notify
        ):
            raise ConfigError("notify_command must be an argv array")
        if (
            not validation_collections
            or len(set(validation_collections)) != len(validation_collections)
            or any(
                not PACKAGE_RE.fullmatch(v) or not v.startswith("collection-lang")
                for v in validation_collections
            )
        ):
            raise ConfigError(
                "validation_collections must be unique TeX Live language collection names"
            )
        hard_limit_enforcement = raw.get("hard_limit_enforcement", "application")
        if hard_limit_enforcement != "application":
            raise ConfigError(
                "hard_limit_enforcement must be 'application' on this non-invasive VPS setup"
            )
        sync_enabled = raw.get("sync_enabled", False)
        if not isinstance(sync_enabled, bool):
            raise ConfigError("sync_enabled must be boolean")
        latest_lookback_days = integer("latest_lookback_days", 14, 1)
        if latest_lookback_days > 90:
            raise ConfigError("latest_lookback_days must not exceed 90")
        return cls(
            root=root,
            public_base_url=public_url.rstrip("/"),
            upstream_base_url=upstream_url.rstrip("/"),
            active_year=year,
            architectures=architectures,
            profile=Path(raw.get("profile", "/etc/texlive-ci/texlive.profile")),
            keyring=Path(raw.get("keyring", "/etc/texlive-ci/texlive.gpg")),
            hard_limit=hard,
            gc_start=start,
            gc_target=target,
            sync_peak_limit=peak,
            os_free_min=gib("os_free_min_gib", 3),
            keep_generations=integer("keep_generations", 3, 1),
            keep_hours=integer("keep_hours", 72, 1),
            sync_timeout=sync_timeout,
            reservation_ttl=ttl,
            max_reserved_snapshots=integer("max_reserved_snapshots", 2, 1),
            stale_update_hours=integer("stale_update_hours", 48, 1),
            metadata_headroom=integer("metadata_headroom_mib", 256, 1) * 1024 * 1024,
            temp_multiplier_milli=integer("temporary_space_percent", 115, 100) * 10,
            hard_limit_enforcement=hard_limit_enforcement,
            notify_command=tuple(notify),
            latest_lookback_days=latest_lookback_days,
            validation_collections=validation_collections,
            ci_job_timeout=ci_job_timeout,
            sync_enabled=sync_enabled,
        )


@contextlib.contextmanager
def locked(
    path: Path, exclusive: bool = True, nonblocking: bool = False
) -> Iterator[None]:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a+b") as stream:
        operation = fcntl.LOCK_EX if exclusive else fcntl.LOCK_SH
        if nonblocking:
            operation |= fcntl.LOCK_NB
        try:
            fcntl.flock(stream, operation)
        except BlockingIOError as error:
            raise MirrorError(f"lock is busy: {path}") from error
        yield


def validate_id(value: Any) -> str:
    if not isinstance(value, str) or not ID_RE.fullmatch(value):
        raise StateError(f"invalid snapshot id: {value!r}")
    return value


def safe_relative_path(value: Any) -> str:
    if not isinstance(value, str) or not value or "\\" in value:
        raise StateError(f"unsafe relative path: {value!r}")
    path = PurePosixPath(value)
    if path.is_absolute() or str(path) != value or any(
        part in {"", ".", ".."} for part in path.parts
    ):
        raise StateError(f"unsafe relative path: {value!r}")
    return value


def validate_manifest_item(item: Any) -> tuple[str, str, int]:
    if not isinstance(item, dict):
        raise StateError("snapshot manifest contains a non-object file")
    relative = safe_relative_path(item.get("path"))
    checksum = item.get("sha512")
    size = item.get("size")
    if not isinstance(checksum, str) or not re.fullmatch(r"[0-9a-f]{128}", checksum):
        raise StateError(f"snapshot manifest checksum is invalid: {relative}")
    if isinstance(size, bool) or not isinstance(size, int) or size < 0:
        raise StateError(f"snapshot manifest size is invalid: {relative}")
    return relative, checksum, size


def validate_snapshot_record(snapshot_id: str, record: Any) -> None:
    match = ID_RE.fullmatch(validate_id(snapshot_id))
    if not isinstance(record, dict) or match is None:
        raise StateError(f"invalid snapshot record: {snapshot_id}")
    required = {
        "year",
        "publishedAt",
        "status",
        "canonicalDate",
        "databaseSha512",
        "installerSha512",
    }
    if not required.issubset(record):
        raise StateError(f"snapshot record is incomplete: {snapshot_id}")
    year = record["year"]
    if isinstance(year, bool) or not isinstance(year, int) or year != int(match["year"]):
        raise StateError(f"snapshot year is inconsistent: {snapshot_id}")
    if not isinstance(record["status"], str) or record["status"] not in {
        "published",
        "deleting",
    }:
        raise StateError(f"snapshot status is invalid: {snapshot_id}")
    parse_time(record["publishedAt"])
    primary = record["canonicalDate"]
    if not isinstance(primary, str):
        raise StateError(f"snapshot canonical date is invalid: {snapshot_id}")
    if "canonicalDates" not in record:
        record["canonicalDates"] = [primary]
    dates = record["canonicalDates"]
    if (
        not isinstance(dates, list)
        or not dates
        or not all(isinstance(value, str) for value in dates)
    ):
        raise StateError(f"snapshot canonical dates are invalid: {snapshot_id}")
    if len(dates) != len(set(dates)) or primary not in dates:
        raise StateError(f"snapshot canonical dates are invalid: {snapshot_id}")
    for value in dates:
        try:
            date = dt.date.fromisoformat(value)
        except ValueError as error:
            raise StateError(
                f"snapshot canonical date is invalid: {snapshot_id}"
            ) from error
        if date.year != year:
            raise StateError(f"snapshot canonical year is inconsistent: {snapshot_id}")
    for name in ("databaseSha512", "installerSha512"):
        if not isinstance(record[name], str) or not re.fullmatch(
            r"[0-9a-f]{128}", record[name]
        ):
            raise StateError(f"snapshot {name} is invalid: {snapshot_id}")


def validate_internal_protection(run_id: Any, value: Any) -> None:
    if not isinstance(run_id, str) or not re.fullmatch(
        r"[A-Za-z0-9][A-Za-z0-9_.-]{0,199}", run_id
    ):
        raise StateError("internal protection has an invalid run id")
    if not isinstance(value, dict):
        raise StateError(f"internal protection is invalid: {run_id}")
    snapshot_id = value.get("snapshotId")
    validate_id(snapshot_id)
    created = parse_time(value.get("createdAt"))
    expires = parse_time(value.get("expiresAt"))
    if expires <= created:
        raise StateError(f"internal protection expiry is invalid: {run_id}")


def safe_child(parent: Path, name: str) -> Path:
    validate_id(name)
    result = parent / name
    if result.parent != parent or result.is_symlink():
        raise StateError(f"unsafe managed path: {result}")
    return result


def apparent_unique_bytes(root: Path) -> int:
    """Count allocated blocks once per inode; do not follow symlinks/mounts."""
    seen: set[tuple[int, int]] = set()
    total = 0
    root_stat = root.stat()
    for directory, dirs, files in os.walk(root, topdown=True, followlinks=False):
        base = Path(directory)
        kept = []
        for item in dirs:
            path = base / item
            info = path.lstat()
            if stat.S_ISLNK(info.st_mode) or info.st_dev != root_stat.st_dev:
                continue
            kept.append(item)
        dirs[:] = kept
        for item in files:
            path = base / item
            info = path.lstat()
            if not stat.S_ISREG(info.st_mode) or info.st_dev != root_stat.st_dev:
                continue
            identity = (info.st_dev, info.st_ino)
            if identity not in seen:
                seen.add(identity)
                total += info.st_blocks * 512
    return total


def filesystem_metrics(root: Path) -> dict[str, int]:
    usage = shutil.disk_usage(root)
    stats = os.statvfs(root)
    return {
        "managedBytes": apparent_unique_bytes(root),
        "filesystemFreeBytes": usage.free,
        "osFilesystemFreeBytes": shutil.disk_usage("/").free,
        "inodeFree": stats.f_favail,
        "inodeTotal": stats.f_files,
    }


def safe_rmtree(path: Path, expected_device: int) -> None:
    """Remove a managed tree without following links or crossing mounts."""
    info = path.lstat()
    if stat.S_ISLNK(info.st_mode) or info.st_dev != expected_device:
        raise StateError(f"refusing unsafe recursive deletion: {path}")
    if not stat.S_ISDIR(info.st_mode):
        if not stat.S_ISREG(info.st_mode):
            raise StateError(f"refusing special file deletion: {path}")
        path.unlink()
        return
    # Published directories become writable only after their atomic move into
    # private trash. File inode modes (including shared hardlinks) are untouched.
    path.chmod(0o700)
    with os.scandir(path) as entries:
        children = [Path(entry.path) for entry in entries]
    for child in children:
        safe_rmtree(child, expected_device)
    path.rmdir()


def ensure_layout(config: Config) -> None:
    config.root.mkdir(parents=True, exist_ok=True)
    if config.root.is_symlink():
        raise ConfigError("managed root must not be a symlink")
    for name, mode in (
        ("snapshots", 0o755),
        ("staging", 0o700),
        ("trash", 0o700),
        ("state", 0o700),
    ):
        path = config.root / name
        path.mkdir(mode=mode, exist_ok=True)
        if path.is_symlink() or path.stat().st_dev != config.root.stat().st_dev:
            raise ConfigError(
                f"{path} must be a real directory on the managed filesystem"
            )
    (config.root / "state" / "locks").mkdir(mode=0o700, exist_ok=True)
    (config.root / "state" / "reservations").mkdir(mode=0o700, exist_ok=True)


def default_state() -> dict[str, Any]:
    return {
        "schema": STATE_SCHEMA,
        "latest": None,
        "snapshots": {},
        "internalProtections": {},
        "lastEvent": None,
    }


def load_state(config: Config, create: bool = False) -> dict[str, Any]:
    path = config.root / "state" / "state.json"
    if not path.exists() and create:
        for name in ("snapshots", "staging"):
            if any((config.root / name).iterdir()):
                raise StateError(
                    "state is missing while managed data exists; operator recovery is required"
                )
        value = default_state()
        atomic_json(path, value)
        return value
    value = read_json(path)
    if not isinstance(value, dict) or value.get("schema") != STATE_SCHEMA:
        raise StateError("state schema is missing or unsupported")
    if not isinstance(value.get("snapshots"), dict) or not isinstance(
        value.get("internalProtections"), dict
    ):
        raise StateError("state has invalid collections")
    for snapshot_id, record in value["snapshots"].items():
        validate_snapshot_record(snapshot_id, record)
    for run_id, protection in value["internalProtections"].items():
        validate_internal_protection(run_id, protection)
        protected_snapshot = value["snapshots"].get(protection["snapshotId"])
        if not protected_snapshot or protected_snapshot["status"] != "published":
            raise StateError(
                f"internal protection references an unavailable snapshot: {run_id}"
            )
    latest = value.get("latest")
    if latest is not None and latest not in value["snapshots"]:
        raise StateError("latest does not name a known snapshot")
    if latest is not None and value["snapshots"][latest]["status"] != "published":
        raise StateError("latest snapshot is not published")
    active_published = [
        snapshot_id
        for snapshot_id, record in value["snapshots"].items()
        if record["year"] == config.active_year and record["status"] == "published"
    ]
    if active_published and latest not in active_published:
        raise StateError("active year has no valid latest snapshot")
    return value


def save_state(config: Config, value: dict[str, Any]) -> None:
    atomic_json(config.root / "state" / "state.json", value)


def emit_event(
    config: Config,
    state: dict[str, Any],
    kind: str,
    detail: dict[str, Any],
    now: dt.datetime,
) -> None:
    event = {"at": iso(now), "kind": kind, **detail}
    state["lastEvent"] = event
    print(canonical_json(event).decode().rstrip())
    if config.notify_command and kind in {
        "capacity_blocked",
        "verification_failed",
        "gc_failed",
        "stale",
    }:
        notification_file = config.root / "state" / "notification.json"
        previous = None
        if notification_file.exists():
            previous = read_json(notification_file)
        # Notify on state change, then at most once per six hours.
        due = (
            not isinstance(previous, dict)
            or previous.get("kind") != kind
            or (now - parse_time(previous["at"])).total_seconds() >= 21600
        )
        if due:
            subprocess.run(
                [
                    *config.notify_command,
                    kind,
                    json.dumps(detail, separators=(",", ":")),
                ],
                check=False,
                timeout=30,
            )
            atomic_json(notification_file, {"kind": kind, "at": iso(now)})


def reservation_files(config: Config) -> list[Path]:
    directory = config.root / "state" / "reservations"
    return sorted(
        path
        for path in directory.iterdir()
        if path.is_file() and path.suffix == ".json" and not path.is_symlink()
    )


def active_reservations(
    config: Config, now: dt.datetime, purge: bool = True
) -> list[dict[str, Any]]:
    result = []
    for path in reservation_files(config):
        value = read_json(path)
        required = {
            "schema",
            "token",
            "snapshotId",
            "owner",
            "architecture",
            "createdAt",
            "expiresAt",
        }
        if (
            not isinstance(value, dict)
            or not required.issubset(value)
            or value["schema"] != STATE_SCHEMA
        ):
            raise StateError(f"reservation state is corrupt: {path}")
        validate_id(value["snapshotId"])
        if (
            not isinstance(value["token"], str)
            or not re.fullmatch(r"[0-9a-f]{64}", value["token"])
            or path.stem != value["token"]
            or not isinstance(value["architecture"], str)
            or value["architecture"] not in ARCHES
            or not isinstance(value["owner"], str)
            or not OWNER_RE.fullmatch(value["owner"])
            or value["token"]
            != reservation_token(
                value["owner"], value["architecture"], value["snapshotId"]
            )
        ):
            raise StateError(f"reservation state is unsafe: {path}")
        created = parse_time(value["createdAt"])
        expires = parse_time(value["expiresAt"])
        if created > now or expires <= created or expires > created + dt.timedelta(hours=8):
            raise StateError(f"reservation timestamps are unsafe: {path}")
        if expires <= now:
            if purge:
                path.unlink()
            continue
        result.append(value)
    return result


def reservation_token(owner: str, architecture: str, snapshot_id: str) -> str:
    return hashlib.sha256(
        f"{owner}\0{architecture}\0{snapshot_id}".encode()
    ).hexdigest()


def reserve(
    config: Config,
    snapshot_id: str | None,
    canonical_date: str | None,
    owner: str,
    architecture: str,
    now: dt.datetime,
) -> dict[str, Any]:
    if (snapshot_id is None) == (canonical_date is None):
        raise ConfigError("exactly one of snapshot or canonical date is required")
    if snapshot_id is not None:
        validate_id(snapshot_id)
    if architecture not in config.architectures:
        raise ConfigError(f"architecture is not enabled: {architecture}")
    if not OWNER_RE.fullmatch(owner):
        raise ConfigError("owner contains unsupported characters")
    with locked(config.root / "state" / "locks" / "management.lock"):
        state = load_state(config)
        if canonical_date is not None:
            matches = [
                key
                for key, value in state["snapshots"].items()
                if value.get("status") == "published"
                and canonical_date
                in value.get("canonicalDates", [value.get("canonicalDate")])
            ]
            # A format/profile migration can legitimately publish more than one
            # snapshot for the same signed canonical archive. Prefer only the
            # explicitly recorded latest snapshot; never choose another match
            # implicitly. Without that unambiguous pointer, fail closed.
            latest = state.get("latest")
            if latest in matches:
                snapshot_id = latest
            elif len(matches) == 1:
                snapshot_id = matches[0]
            else:
                raise MirrorError(
                    "requested canonical date does not resolve to exactly one published snapshot"
                )
        assert snapshot_id is not None
        entry = state["snapshots"].get(snapshot_id)
        path = safe_child(config.root / "snapshots", snapshot_id)
        if not entry or entry.get("status") != "published" or not path.is_dir():
            raise MirrorError("requested snapshot is not reservable")
        reservations = active_reservations(config, now)
        token = reservation_token(owner, architecture, snapshot_id)
        target = config.root / "state" / "reservations" / f"{token}.json"
        existing = next(
            (value for value in reservations if value["token"] == token), None
        )
        if existing:
            # Duplicate acquisition is idempotent and never extends the original TTL.
            return existing
        distinct = {value["snapshotId"] for value in reservations}
        if (
            snapshot_id not in distinct
            and len(distinct) >= config.max_reserved_snapshots
        ):
            raise CapacityBlocked(
                "maximum number of concurrently reserved snapshots reached"
            )
        value = {
            "schema": STATE_SCHEMA,
            "token": token,
            "snapshotId": snapshot_id,
            "owner": owner,
            "architecture": architecture,
            "createdAt": iso(now),
            "expiresAt": iso(now + dt.timedelta(seconds=config.reservation_ttl)),
            "url": f"{config.public_base_url}/snapshots/{snapshot_id}/tlnet",
            "canonicalDate": entry["canonicalDate"],
            "databaseSha512": entry["databaseSha512"],
            "installerSha512": entry["installerSha512"],
        }
        atomic_json(target, value)
        return value


def release(config: Config, token: str, owner: str) -> bool:
    if not re.fullmatch(r"[0-9a-f]{64}", token) or not OWNER_RE.fullmatch(owner):
        raise ConfigError("invalid reservation token or owner")
    with locked(config.root / "state" / "locks" / "management.lock"):
        path = config.root / "state" / "reservations" / f"{token}.json"
        if not path.exists():
            return False
        value = read_json(path)
        if value.get("owner") != owner or value.get("token") != token:
            raise MirrorError("reservation is not owned by caller")
        path.unlink()
        return True


@dataclasses.dataclass
class Package:
    name: str
    revision: str
    depends: list[str]
    checksum: str | None
    size: int | None
    doc_checksum: str | None
    doc_size: int | None
    src_checksum: str | None
    src_size: int | None


def parse_tlpdb(text: str) -> dict[str, Package]:
    packages: dict[str, Package] = {}
    for stanza in text.split("\n\n"):
        fields: dict[str, list[str]] = {}
        for line in stanza.splitlines():
            if not line or line[0].isspace():
                continue
            key, _, value = line.partition(" ")
            fields.setdefault(key, []).append(value)
        if "name" not in fields:
            continue
        name = fields["name"][0]
        if not PACKAGE_RE.fullmatch(name):
            raise VerificationError(f"unsafe package name in tlpdb: {name!r}")

        def one(key: str) -> str | None:
            values = fields.get(key, [])
            if len(values) > 1:
                raise VerificationError(f"duplicate {key} for {name}")
            return values[0] if values else None

        def number(key: str) -> int | None:
            value = one(key)
            if value is None:
                return None
            if not value.isdigit() or int(value) <= 0:
                raise VerificationError(f"invalid {key} for {name}")
            return int(value)

        if name in packages:
            raise VerificationError(f"duplicate package in tlpdb: {name}")
        revision = one("revision")
        has_archive = one("containerchecksum") is not None or one("containersize") is not None
        if has_archive and revision is None:
            raise VerificationError(f"archive package has no revision: {name}")
        revision = revision or "0"
        if not REVISION_RE.fullmatch(revision):
            raise VerificationError(f"invalid revision for {name}")
        packages[name] = Package(
            name,
            revision,
            fields.get("depend", []),
            one("containerchecksum"),
            number("containersize"),
            one("doccontainerchecksum"),
            number("doccontainersize"),
            one("srccontainerchecksum"),
            number("srccontainersize"),
        )
    return packages


def profile_roots(profile: Path, configured_arches: tuple[str, ...]) -> list[str]:
    roots: list[str] = []
    declared_arches: set[str] = set()
    for raw in profile.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split()
        if len(parts) == 2 and parts[1] == "1":
            if parts[0].startswith("binary_"):
                declared_arches.add(parts[0][7:])
            elif parts[0].startswith(("collection-", "scheme-")):
                roots.append(parts[0])
        if (
            parts
            and parts[0] in {"tlpdbopt_install_docfiles", "tlpdbopt_install_srcfiles"}
            and parts[-1] != "0"
        ):
            raise ConfigError("mirror profile must keep doc/src installation disabled")
    expected = {ARCHES[value] for value in configured_arches}
    if declared_arches != expected:
        raise ConfigError(
            f"profile architectures {sorted(declared_arches)} do not match configured architectures {sorted(expected)}"
        )
    if not roots:
        raise ConfigError("profile contains no collection roots")
    return roots


def dependency_closure(
    packages: dict[str, Package], roots: list[str], architectures: tuple[str, ...]
) -> set[str]:
    result: set[str] = set()
    queue: list[tuple[str, str | None]] = [(root, None) for root in roots]
    arch_names = [ARCHES[value] for value in architectures]
    while queue:
        name, inherited_arch = queue.pop()
        if name.endswith(".ARCH"):
            for arch in arch_names:
                queue.append((name[:-5] + f".{arch}", arch))
            continue
        if name.startswith("setting_available_architectures:") or name.startswith(
            "setting_available_architectures/"
        ):
            continue
        if ">=" in name:
            name = name.split(">=", 1)[0].strip()
        if name in result:
            continue
        package = packages.get(name)
        if package is None:
            # Virtual dependencies in 00texlive.config are settings, not archives.
            if "/" in name:
                continue
            raise VerificationError(f"dependency is absent from signed tlpdb: {name}")
        result.add(name)
        for dependency in package.depends:
            if dependency.endswith(".ARCH"):
                if inherited_arch:
                    queue.append(
                        (dependency[:-5] + f".{inherited_arch}", inherited_arch)
                    )
                else:
                    for arch in arch_names:
                        queue.append((dependency[:-5] + f".{arch}", arch))
            else:
                queue.append((dependency, inherited_arch))
    return result


def package_files(
    packages: dict[str, Package], selected: set[str]
) -> list[dict[str, Any]]:
    result = []
    for name in sorted(selected):
        package = packages[name]
        if package.checksum is None and package.size is None:
            continue
        if (
            not package.checksum
            or not re.fullmatch(r"[0-9a-fA-F]{128}", package.checksum)
            or package.size is None
            or not isinstance(package.revision, str)
            or not REVISION_RE.fullmatch(package.revision)
        ):
            raise VerificationError(f"package has unknown size/checksum: {name}")
        result.append(
            {
                "path": f"archive/{name}.r{package.revision}.tar.xz",
                "sha512": package.checksum.lower(),
                "size": package.size,
            }
        )
    return result


def curl_download(
    url: str,
    destination: Path,
    expected_size: int | None = None,
    max_size: int | None = None,
) -> None:
    if expected_size is not None and max_size is None:
        max_size = expected_size
    if max_size is not None and max_size <= 0:
        raise VerificationError(f"download size budget exhausted for {url}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    partial = destination.with_name(destination.name + ".partial")
    partial.unlink(missing_ok=True)
    command = [
        "curl",
        "--fail",
        "--location",
        "--retry",
        "3",
        "--retry-delay",
        "2",
        "--silent",
        "--show-error",
        "--connect-timeout",
        "15",
        "--max-time",
        "1800",
        "--proto",
        "=https",
        "--tlsv1.2",
    ]
    if max_size is not None:
        command.extend(["--max-filesize", str(max_size)])
    command.extend(["--output", "-", url])
    process = subprocess.Popen(command, stdout=subprocess.PIPE)
    actual_size = 0
    assert process.stdout is not None
    try:
        with partial.open("wb") as output:
            while block := process.stdout.read(1024 * 1024):
                if max_size is not None and actual_size + len(block) > max_size:
                    process.kill()
                    process.wait()
                    raise VerificationError(f"download exceeds size budget for {url}")
                output.write(block)
                actual_size += len(block)
        if process.wait() != 0:
            raise VerificationError(f"download failed for {url}")
        if expected_size is not None and actual_size != expected_size:
            raise VerificationError(f"download size mismatch for {url}")
        os.replace(partial, destination)
    except BaseException:
        if process.poll() is None:
            process.kill()
            process.wait()
        partial.unlink(missing_ok=True)
        raise


def bounded_xz_decompress(path: Path, max_output_size: int) -> bytes:
    if max_output_size <= 0:
        raise VerificationError("metadata decompression budget is exhausted")
    process = subprocess.Popen(
        ["xz", f"--memlimit-decompress={max_output_size}", "-dc", str(path)],
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    )
    output = bytearray()
    assert process.stdout is not None
    try:
        while block := process.stdout.read(1024 * 1024):
            if len(output) + len(block) > max_output_size:
                process.kill()
                process.wait()
                raise VerificationError("uncompressed tlpdb exceeds metadata budget")
            output.extend(block)
        if process.wait() != 0:
            raise VerificationError("cannot decompress signed tlpdb")
    except BaseException:
        if process.poll() is None:
            process.kill()
            process.wait()
        raise
    return bytes(output)


def verified_metadata(
    config: Config, canonical_date: str, staging_tlnet: Path
) -> tuple[bytes, str, str, str]:
    if not re.fullmatch(
        r"20\d\d-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])", canonical_date
    ):
        raise ConfigError("canonical date must be YYYY-MM-DD")
    try:
        date = dt.date.fromisoformat(canonical_date)
    except ValueError as error:
        raise ConfigError("canonical date is not a real calendar date") from error
    if date.year != config.active_year:
        raise ConfigError("canonical date must belong to active_year")
    upstream = f"{config.upstream_base_url}/{date.year:04d}/{date.month:02d}/{date.day:02d}/tlnet"
    names = [
        "install-tl-unx.tar.gz",
        "install-tl-unx.tar.gz.sha512",
        "install-tl-unx.tar.gz.sha512.asc",
        "tlpkg/texlive.tlpdb.xz",
        "tlpkg/texlive.tlpdb.sha512",
        "tlpkg/texlive.tlpdb.sha512.asc",
    ]
    metadata_bytes = 0
    for name in names:
        remaining = config.metadata_headroom - metadata_bytes
        curl_download(
            f"{upstream}/{name}", staging_tlnet / name, max_size=remaining
        )
        metadata_bytes += (staging_tlnet / name).stat().st_size
    subprocess.run(
        [
            "gpgv",
            "--keyring",
            str(config.keyring),
            str(staging_tlnet / "install-tl-unx.tar.gz.sha512.asc"),
            str(staging_tlnet / "install-tl-unx.tar.gz.sha512"),
        ],
        check=True,
    )
    subprocess.run(
        [
            "gpgv",
            "--keyring",
            str(config.keyring),
            str(staging_tlnet / "tlpkg/texlive.tlpdb.sha512.asc"),
            str(staging_tlnet / "tlpkg/texlive.tlpdb.sha512"),
        ],
        check=True,
    )
    installer_line = (
        (staging_tlnet / "install-tl-unx.tar.gz.sha512")
        .read_text()
        .splitlines()[0]
        .split()
    )
    db_line = (
        (staging_tlnet / "tlpkg/texlive.tlpdb.sha512")
        .read_text()
        .splitlines()[0]
        .split()
    )
    if len(installer_line) < 2 or len(db_line) < 2:
        raise VerificationError("signed checksum file is malformed")
    installer_hash, db_hash = installer_line[0].lower(), db_line[0].lower()
    if sha512_file(staging_tlnet / "install-tl-unx.tar.gz") != installer_hash:
        raise VerificationError("installer checksum mismatch")
    uncompressed = bounded_xz_decompress(
        staging_tlnet / "tlpkg/texlive.tlpdb.xz",
        config.metadata_headroom - metadata_bytes,
    )
    if hashlib.sha512(uncompressed).hexdigest() != db_hash:
        raise VerificationError("signed tlpdb checksum mismatch")
    packages = parse_tlpdb(uncompressed.decode("utf-8"))
    config_package = packages.get("00texlive.config")
    if (
        not config_package
        or f"release/{config.active_year}" not in config_package.depends
    ):
        raise VerificationError("signed tlpdb release does not match active_year")
    return uncompressed, db_hash, installer_hash, upstream


def storage_guard_ready(config: Config) -> None:
    if config.hard_limit_enforcement != "application":
        raise ConfigError("unsupported hard-limit enforcement mode")
    metrics = filesystem_metrics(config.root)
    if metrics["managedBytes"] >= config.hard_limit:
        raise CapacityBlocked("managed usage has reached the application hard limit")
    if metrics["osFilesystemFreeBytes"] < config.os_free_min:
        raise CapacityBlocked(
            "OS filesystem free space is below the configured minimum"
        )


def existing_checksum_index(
    config: Config, state: dict[str, Any]
) -> dict[tuple[str, int], Path]:
    index: dict[tuple[str, int], Path] = {}
    source_id = state.get("latest")
    selected_records = (
        [(source_id, state["snapshots"].get(source_id))] if source_id else []
    )
    for snapshot_id, record in selected_records:
        if record is None:
            continue
        if record.get("status") != "published":
            continue
        manifest_path = (
            safe_child(config.root / "snapshots", snapshot_id) / ".snapshot.json"
        )
        manifest = read_json(manifest_path)
        items = manifest.get("files")
        if not isinstance(items, list):
            raise StateError(f"snapshot manifest files are invalid: {snapshot_id}")
        for item in items:
            relative, checksum, size = validate_manifest_item(item)
            candidate = (
                safe_child(config.root / "snapshots", snapshot_id)
                / "tlnet"
                / relative
            )
            if candidate.is_file() and not candidate.is_symlink():
                index[(checksum, size)] = candidate
    return index


def estimate_peak(
    metrics: dict[str, int],
    files: list[dict[str, Any]],
    index: dict[tuple[str, int], Path],
    headroom: int,
    temp_milli: int,
) -> tuple[int, int]:
    new_bytes = sum(
        item["size"] for item in files if (item["sha512"], item["size"]) not in index
    )
    temporary = (new_bytes * temp_milli + 999) // 1000
    return metrics["managedBytes"] + new_bytes + temporary + headroom, new_bytes


def capacity_allows(
    config: Config, metrics: dict[str, int], peak: int, file_count: int
) -> bool:
    additional = peak - metrics["managedBytes"]
    return (
        peak <= config.sync_peak_limit
        and metrics["filesystemFreeBytes"] - additional >= config.os_free_min
        and metrics["osFilesystemFreeBytes"] >= config.os_free_min
        and metrics["inodeFree"] > file_count * 2 + 100
    )


def protect(
    config: Config,
    state: dict[str, Any],
    snapshot_id: str,
    run_id: str,
    now: dt.datetime,
) -> None:
    state["internalProtections"][run_id] = {
        "snapshotId": snapshot_id,
        "createdAt": iso(now),
        "expiresAt": iso(now + dt.timedelta(seconds=config.sync_timeout + 900)),
    }


def protected_ids(config: Config, state: dict[str, Any], now: dt.datetime) -> set[str]:
    reservations = active_reservations(config, now)
    protected: set[str] = set()
    for value in reservations:
        record = state["snapshots"].get(value["snapshotId"])
        if not record or record["status"] != "published":
            raise StateError("reservation references an unavailable snapshot")
        protected.add(value["snapshotId"])
    latest = state.get("latest")
    if latest:
        latest_record = state["snapshots"].get(latest)
        if (
            latest_record
            and latest_record.get("year") == config.active_year
            and latest_record.get("status") == "published"
        ):
            protected.add(latest)
    expired = []
    for run_id, value in state["internalProtections"].items():
        if parse_time(value["expiresAt"]) > now:
            protected.add(value["snapshotId"])
        else:
            expired.append(run_id)
    for run_id in expired:
        del state["internalProtections"][run_id]
    return protected


def reconcile_state(config: Config, state: dict[str, Any]) -> None:
    snapshot_root = config.root / "snapshots"
    disk_ids: set[str] = set()
    for path in snapshot_root.iterdir():
        if path.is_symlink() or not path.is_dir():
            raise StateError(f"unsafe snapshot entry: {path}")
        snapshot_id = validate_id(path.name)
        disk_ids.add(snapshot_id)
        if snapshot_id not in state["snapshots"]:
            manifest = read_json(path / ".snapshot.json")
            if (
                manifest.get("snapshotId") != snapshot_id
                or manifest.get("schema") != STATE_SCHEMA
            ):
                raise StateError(
                    f"orphan snapshot has no valid completion manifest: {snapshot_id}"
                )
            items = manifest.get("files")
            if not isinstance(items, list):
                raise StateError(
                    f"orphan snapshot manifest files are invalid: {snapshot_id}"
                )
            for item in items:
                relative, checksum, size = validate_manifest_item(item)
                target = path / "tlnet" / relative
                if (
                    not target.is_file()
                    or target.is_symlink()
                    or target.stat().st_size != size
                    or sha512_file(target) != checksum
                ):
                    raise StateError(
                        f"orphan snapshot verification failed: {snapshot_id}"
                    )
            recovered_record = {
                "year": manifest["year"],
                "publishedAt": manifest["publishedAt"],
                "status": "published",
                "canonicalDate": manifest["canonicalDate"],
                "canonicalDates": [manifest["canonicalDate"]],
                "databaseSha512": manifest["databaseSha512"],
                "installerSha512": manifest["installerSha512"],
            }
            validate_snapshot_record(snapshot_id, recovered_record)
            state["snapshots"][snapshot_id] = recovered_record
            path.chmod(0o555)
    for snapshot_id, record in list(state["snapshots"].items()):
        if record.get("status") == "deleting" and snapshot_id not in disk_ids:
            del state["snapshots"][snapshot_id]
        elif record.get("status") == "deleting" and snapshot_id in disk_ids:
            # Crash before the snapshots->trash rename: restore visibility and
            # let a fresh locked GC decision choose it again.
            record["status"] = "published"
        elif record.get("status") == "published" and snapshot_id not in disk_ids:
            raise StateError(f"published snapshot is missing: {snapshot_id}")
    latest = state.get("latest")
    if latest:
        record = state["snapshots"].get(latest)
        if not record or record.get("status") != "published":
            raise StateError("latest snapshot is not healthy")
        atomic_json(
            config.root / "latest.json",
            {
                "snapshotId": latest,
                "url": f"{config.public_base_url}/snapshots/{latest}/tlnet",
                "publishedAt": record["publishedAt"],
            },
            0o644,
        )
    else:
        (config.root / "latest.json").unlink(missing_ok=True)


def delete_candidates(
    config: Config, state: dict[str, Any], now: dt.datetime, pressure: bool
) -> list[str]:
    protected = protected_ids(config, state, now)
    published = [
        (snapshot_id, value)
        for snapshot_id, value in state["snapshots"].items()
        if value.get("status") == "published"
    ]
    published.sort(key=lambda pair: parse_time(pair[1]["publishedAt"]), reverse=True)
    keep_recent = {
        snapshot_id for snapshot_id, _ in published[: config.keep_generations]
    }
    cutoff = now - dt.timedelta(hours=config.keep_hours)
    normal = []
    pressure_extra = []
    for snapshot_id, value in reversed(published):
        if snapshot_id in protected:
            continue
        too_old = parse_time(value["publishedAt"]) < cutoff
        outside_count = snapshot_id not in keep_recent
        if too_old or outside_count:
            normal.append(snapshot_id)
        elif pressure:
            pressure_extra.append(snapshot_id)
    return normal + pressure_extra


def drain_trash(config: Config) -> int:
    count = 0
    root_device = config.root.stat().st_dev
    for path in sorted((config.root / "trash").iterdir()):
        info = path.lstat()
        base_name = path.name.split(".", 1)[0]
        safe_name = bool(
            ID_RE.fullmatch(base_name)
            or re.fullmatch(r"staging-[A-Za-z0-9][A-Za-z0-9_.-]{0,199}", base_name)
        )
        if stat.S_ISLNK(info.st_mode) or info.st_dev != root_device or not safe_name:
            raise StateError(f"unsafe trash entry: {path}")
        if path.is_dir():
            safe_rmtree(path, root_device)
        else:
            path.unlink()
        count += 1
    return count


def recover_staging(config: Config, state: dict[str, Any], now: dt.datetime) -> int:
    protected_runs = {
        key
        for key, value in state["internalProtections"].items()
        if parse_time(value["expiresAt"]) > now
    }
    count = 0
    root_device = config.root.stat().st_dev
    for path in sorted((config.root / "staging").iterdir()):
        info = path.lstat()
        if (
            stat.S_ISLNK(info.st_mode)
            or info.st_dev != root_device
            or not path.is_dir()
        ):
            raise StateError(f"unsafe staging entry: {path}")
        marker = path / ".operation.json"
        if not marker.is_file() or marker.is_symlink():
            raise StateError(
                f"untrusted staging entry requires operator review: {path}"
            )
        operation = read_json(marker)
        if operation.get("runId") in protected_runs:
            continue
        if parse_time(operation["deadline"]) > now:
            continue
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,199}", path.name):
            raise StateError(f"unsafe staging name: {path}")
        destination = (
            config.root / "trash" / f"staging-{path.name}.{int(now.timestamp())}"
        )
        os.replace(path, destination)
        count += 1
    return count


def sync_is_running(config: Config) -> bool:
    try:
        with locked(config.root / "state" / "locks" / "sync.lock", nonblocking=True):
            return False
    except MirrorError:
        return True


def gc(
    config: Config, now: dt.datetime | None = None, reserve_bytes: int = 0
) -> dict[str, Any]:
    now = now or utcnow()
    ensure_layout(config)
    before = filesystem_metrics(config.root)
    moved: list[str] = []
    with locked(config.root / "state" / "locks" / "management.lock"):
        state = load_state(config, create=True)
        reconcile_state(config, state)
        latest = state.get("latest")
        if latest and now - parse_time(
            state["snapshots"][latest]["publishedAt"]
        ) >= dt.timedelta(hours=config.stale_update_hours):
            emit_event(
                config,
                state,
                "stale",
                {
                    "snapshotId": latest,
                    "publishedAt": state["snapshots"][latest]["publishedAt"],
                },
                now,
            )
        # A deadline alone is not evidence that a process is gone. systemd may
        # still be delivering its timeout signal, so never reap staging while
        # the process-level sync lock is held.
        if not sync_is_running(config):
            recover_staging(config, state, now)
        # Existing trash is already unavailable for reservation. Drain outside lock.
        pressure = (
            before["managedBytes"] >= config.gc_start
            or before["managedBytes"] + reserve_bytes > config.sync_peak_limit
        )
        for snapshot_id in delete_candidates(config, state, now, pressure):
            source = safe_child(config.root / "snapshots", snapshot_id)
            if not source.exists():
                raise StateError(
                    f"published snapshot directory is missing: {snapshot_id}"
                )
            destination = (
                config.root / "trash" / f"{snapshot_id}.{int(now.timestamp())}"
            )
            state["snapshots"][snapshot_id]["status"] = "deleting"
            deleting_latest = state.get("latest") == snapshot_id
            if deleting_latest:
                state["latest"] = None
            save_state(config, state)
            os.replace(source, destination)
            if deleting_latest:
                (config.root / "latest.json").unlink(missing_ok=True)
            del state["snapshots"][snapshot_id]
            moved.append(snapshot_id)
            save_state(config, state)
            if not pressure:
                continue
            # Do not assume apparent snapshot size equals freed blocks.
            current = filesystem_metrics(config.root)
            if (
                current["managedBytes"] <= config.gc_target
                and current["managedBytes"] + reserve_bytes <= config.sync_peak_limit
            ):
                break
        save_state(config, state)
    trash_count = drain_trash(config)
    after = filesystem_metrics(config.root)
    result = {
        "deletedSnapshots": moved,
        "trashEntries": trash_count,
        "before": before,
        "after": after,
        "freedBytes": max(0, before["managedBytes"] - after["managedBytes"]),
    }
    return result


def make_snapshot_id(
    year: int, db_hash: str, installer_hash: str, selection: dict[str, Any]
) -> str:
    selection_hash = hashlib.sha512(canonical_json(selection)).hexdigest()
    return f"tl{year}-{db_hash[:16]}-{installer_hash[:16]}-{selection_hash[:16]}-v{MIRROR_FORMAT}"


def resolve_latest_date(config: Config, now: dt.datetime) -> str:
    if now.year != config.active_year:
        raise ConfigError("latest resolution is disabled outside active_year")
    for offset in range(config.latest_lookback_days):
        candidate = now.date() - dt.timedelta(days=offset)
        url = f"{config.upstream_base_url}/{candidate.year:04d}/{candidate.month:02d}/{candidate.day:02d}/tlnet/install-tl-unx.tar.gz.sha512"
        result = subprocess.run(
            [
                "curl",
                "--fail",
                "--location",
                "--silent",
                "--show-error",
                "--connect-timeout",
                "10",
                "--max-time",
                "60",
                "--proto",
                "=https",
                "--output",
                os.devnull,
                url,
            ],
            check=False,
        )
        if result.returncode == 0:
            return candidate.isoformat()
    raise VerificationError(
        "no canonical archive is available within the configured lookback"
    )


def sync(
    config: Config, canonical_date: str, now: dt.datetime | None = None
) -> dict[str, Any]:
    if not config.sync_enabled:
        raise ConfigError("sync is disabled in configuration")
    now = now or utcnow()
    if canonical_date == "latest":
        canonical_date = resolve_latest_date(config, now)
    ensure_layout(config)
    storage_guard_ready(config)
    sync_lock = config.root / "state" / "locks" / "sync.lock"
    with locked(sync_lock, nonblocking=True):
        gc(config, now, config.metadata_headroom)
        metrics = filesystem_metrics(config.root)
        metadata_peak = metrics["managedBytes"] + config.metadata_headroom
        if not capacity_allows(config, metrics, metadata_peak, 16):
            error = CapacityBlocked(
                "metadata working space does not fit within safe capacity"
            )
            with locked(config.root / "state" / "locks" / "management.lock"):
                state = load_state(config)
                emit_event(
                    config, state, "capacity_blocked", {"error": str(error)}, now
                )
                save_state(config, state)
            raise error
        run_id = f"sync-{int(now.timestamp())}-{os.getpid()}"
        staging = config.root / "staging" / run_id
        staging.mkdir(mode=0o700)
        atomic_json(
            staging / ".operation.json",
            {
                "runId": run_id,
                "startedAt": iso(now),
                "deadline": iso(now + dt.timedelta(seconds=config.sync_timeout)),
            },
        )
        try:
            tlpdb, db_hash, installer_hash, upstream = verified_metadata(
                config, canonical_date, staging / "tlnet"
            )
            # install-tl fetches the uncompressed database and validates it
            # against the signed checksum, whose filename is texlive.tlpdb.
            # Preserve the upstream .xz and also publish this verified form.
            plain_tlpdb = staging / "tlnet" / "tlpkg" / "texlive.tlpdb"
            plain_tlpdb.write_bytes(tlpdb)
            packages = parse_tlpdb(tlpdb.decode())
            roots = profile_roots(config.profile, config.architectures) + list(
                config.validation_collections
            )
            selected = dependency_closure(packages, roots, config.architectures)
            files = package_files(packages, selected)
            # Metadata files are part of the manifest and are verified again below.
            for relative in [
                "install-tl-unx.tar.gz",
                "install-tl-unx.tar.gz.sha512",
                "install-tl-unx.tar.gz.sha512.asc",
                "tlpkg/texlive.tlpdb",
                "tlpkg/texlive.tlpdb.xz",
                "tlpkg/texlive.tlpdb.sha512",
                "tlpkg/texlive.tlpdb.sha512.asc",
            ]:
                path = staging / "tlnet" / relative
                files.append(
                    {
                        "path": relative,
                        "sha512": sha512_file(path),
                        "size": path.stat().st_size,
                    }
                )
            selection = {
                "architectures": list(config.architectures),
                "profileSha512": sha512_file(config.profile),
                "validationCollections": list(config.validation_collections),
                "packages": sorted(selected),
                "format": MIRROR_FORMAT,
            }
            snapshot_id = make_snapshot_id(
                config.active_year, db_hash, installer_hash, selection
            )
            with locked(config.root / "state" / "locks" / "management.lock"):
                state = load_state(config)
                existing = state["snapshots"].get(snapshot_id)
                if (
                    existing
                    and existing.get("status") == "published"
                    and safe_child(config.root / "snapshots", snapshot_id).is_dir()
                ):
                    dates = existing.setdefault(
                        "canonicalDates", [existing["canonicalDate"]]
                    )
                    if canonical_date not in dates:
                        dates.append(canonical_date)
                        dates.sort()
                    state["latest"] = snapshot_id
                    state["internalProtections"].pop(run_id, None)
                    save_state(config, state)
                    atomic_json(
                        config.root / "latest.json",
                        {
                            "snapshotId": snapshot_id,
                            "url": f"{config.public_base_url}/snapshots/{snapshot_id}/tlnet",
                            "publishedAt": existing["publishedAt"],
                        },
                        0o644,
                    )
                    safe_rmtree(staging, config.root.stat().st_dev)
                    return {
                        "status": "unchanged",
                        "snapshotId": snapshot_id,
                        "url": f"{config.public_base_url}/snapshots/{snapshot_id}/tlnet",
                    }
                source_id = state.get("latest")
                if source_id:
                    protect(config, state, source_id, run_id, now)
                save_state(config, state)
                index = existing_checksum_index(config, state)
            metrics = filesystem_metrics(config.root)
            peak, new_bytes = estimate_peak(
                metrics,
                files,
                index,
                config.metadata_headroom,
                config.temp_multiplier_milli,
            )
            if not capacity_allows(config, metrics, peak, len(files)):
                gc(config, now, peak - metrics["managedBytes"])
                metrics = filesystem_metrics(config.root)
                with locked(config.root / "state" / "locks" / "management.lock"):
                    state = load_state(config)
                    index = existing_checksum_index(config, state)
                peak, new_bytes = estimate_peak(
                    metrics,
                    files,
                    index,
                    config.metadata_headroom,
                    config.temp_multiplier_milli,
                )
                if not capacity_allows(config, metrics, peak, len(files)):
                    raise CapacityBlocked(
                        f"estimated peak {peak} exceeds safe capacity"
                    )
            for item in files:
                target = staging / "tlnet" / item["path"]
                if target.exists():
                    continue
                source = index.get((item["sha512"], item["size"]))
                if source and sha512_file(source) == item["sha512"]:
                    target.parent.mkdir(parents=True, exist_ok=True)
                    os.link(source, target)
                else:
                    curl_download(f"{upstream}/{item['path']}", target, item["size"])
                if sha512_file(target) != item["sha512"]:
                    raise VerificationError(f"checksum mismatch: {item['path']}")
            for item in files:
                target = staging / "tlnet" / item["path"]
                if (
                    not target.is_file()
                    or target.is_symlink()
                    or target.stat().st_size != item["size"]
                    or sha512_file(target) != item["sha512"]
                ):
                    raise VerificationError(
                        f"final verification failed: {item['path']}"
                    )
            # Re-read actual allocation and OS free space immediately before
            # publication; estimates are admission controls, not proof.
            storage_guard_ready(config)
            manifest = {
                "schema": STATE_SCHEMA,
                "snapshotId": snapshot_id,
                "year": config.active_year,
                "canonicalDate": canonical_date,
                "upstream": upstream,
                "databaseSha512": db_hash,
                "installerSha512": installer_hash,
                "selection": selection,
                "files": sorted(files, key=lambda item: item["path"]),
                "publishedAt": iso(now),
            }
            atomic_json(staging / ".snapshot.json", manifest, 0o444)
            # Freeze only newly-created inodes. Existing linked files already
            # belong to an immutable snapshot and must not be chmod/chown/touched.
            for directory, dirs, names in os.walk(
                staging, topdown=False, followlinks=False
            ):
                for name in names:
                    path = Path(directory) / name
                    if path.is_symlink():
                        raise VerificationError(
                            f"symlink in completed snapshot: {path}"
                        )
                    if path.stat().st_nlink == 1:
                        path.chmod(0o444)
                for name in dirs:
                    (Path(directory) / name).chmod(0o555)
            # Keep the unpublished root private and writable so rename can
            # update its '..' entry. Children and files are already frozen.
            staging.chmod(0o700)
            destination = safe_child(config.root / "snapshots", snapshot_id)
            with locked(config.root / "state" / "locks" / "management.lock"):
                state = load_state(config)
                if destination.exists() or snapshot_id in state["snapshots"]:
                    raise StateError("snapshot appeared concurrently")
                os.replace(staging, destination)
                destination.chmod(0o555)
                state["snapshots"][snapshot_id] = {
                    "year": config.active_year,
                    "publishedAt": iso(now),
                    "status": "published",
                    "canonicalDate": canonical_date,
                    "canonicalDates": [canonical_date],
                    "databaseSha512": db_hash,
                    "installerSha512": installer_hash,
                }
                state["latest"] = snapshot_id
                state["internalProtections"].pop(run_id, None)
                emit_event(
                    config,
                    state,
                    "sync_success",
                    {"snapshotId": snapshot_id, "newBytesEstimated": new_bytes},
                    now,
                )
                save_state(config, state)
                atomic_json(
                    config.root / "latest.json",
                    {
                        "snapshotId": snapshot_id,
                        "url": f"{config.public_base_url}/snapshots/{snapshot_id}/tlnet",
                        "publishedAt": iso(now),
                    },
                    0o644,
                )
            gc(config, now)
            return {
                "status": "published",
                "snapshotId": snapshot_id,
                "url": f"{config.public_base_url}/snapshots/{snapshot_id}/tlnet",
            }
        except BaseException as error:
            with contextlib.suppress(Exception):
                with locked(config.root / "state" / "locks" / "management.lock"):
                    state = load_state(config)
                    state["internalProtections"].pop(run_id, None)
                    kind = (
                        "capacity_blocked"
                        if isinstance(error, CapacityBlocked)
                        else "verification_failed"
                        if isinstance(error, VerificationError)
                        else "sync_failed"
                    )
                    emit_event(config, state, kind, {"error": str(error)}, utcnow())
                    save_state(config, state)
            if staging.exists():
                safe_rmtree(staging, config.root.stat().st_dev)
            raise


def status(config: Config) -> dict[str, Any]:
    ensure_layout(config)
    with locked(config.root / "state" / "locks" / "management.lock", exclusive=False):
        state = load_state(config, create=True)
        reservations = active_reservations(config, utcnow(), purge=False)
        return {
            "latest": state["latest"],
            "snapshots": state["snapshots"],
            "reservations": reservations,
            "metrics": filesystem_metrics(config.root),
            "lastEvent": state.get("lastEvent"),
        }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--config", type=Path, default=Path("/etc/texlive-ci/config.json")
    )
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("validate-config")
    sync_parser = sub.add_parser("sync")
    sync_parser.add_argument("--date", required=True)
    sub.add_parser("gc")
    reserve_parser = sub.add_parser("reserve")
    reserve_selection = reserve_parser.add_mutually_exclusive_group(required=True)
    reserve_selection.add_argument("--snapshot")
    reserve_selection.add_argument("--canonical-date")
    reserve_parser.add_argument("--owner", required=True)
    reserve_parser.add_argument("--architecture", required=True, choices=sorted(ARCHES))
    release_parser = sub.add_parser("release")
    release_parser.add_argument("--token", required=True)
    release_parser.add_argument("--owner", required=True)
    sub.add_parser("status")
    args = parser.parse_args(argv)
    try:
        config = Config.load(args.config)
        if args.command == "validate-config":
            ensure_layout(config)
            storage_guard_ready(config)
            result: Any = {"valid": True}
        elif args.command == "sync":
            result = sync(config, args.date)
        elif args.command == "gc":
            result = gc(config)
        elif args.command == "reserve":
            result = reserve(
                config,
                args.snapshot,
                args.canonical_date,
                args.owner,
                args.architecture,
                utcnow(),
            )
        elif args.command == "release":
            result = {"released": release(config, args.token, args.owner)}
        else:
            result = status(config)
        print(json.dumps(result, sort_keys=True))
        return 0
    except MirrorError as error:
        print(f"texlive-mirror: {error}", file=sys.stderr)
        return error.exit_code
    except (OSError, subprocess.SubprocessError) as error:
        print(f"texlive-mirror: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
