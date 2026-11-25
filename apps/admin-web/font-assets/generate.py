"""Build content-addressed web fonts from the pinned Inter and Noto releases."""

from hashlib import sha256
from io import BytesIO
from itertools import groupby
import json
from pathlib import Path
import sys
from zipfile import ZipFile

from fontTools import subset
from fontTools.ttLib import TTFont


SOURCE_HASHES = {
    "Inter-4.1.zip": "9883fdd4a49d4fb66bd8177ba6625ef9a64aa45899767dde3d36aa425756b11e",
    "NotoSansJP-VF.ttf": "f4b373b226668ee33a6e54b02823dcd2d1209f17159f777421ae8c2275160369",
    "NotoSansSC-VF.ttf": "d68bafcb48a2707749396aa12bbbd833cb70401f3a9a689fd2902c7e0d295964",
    "NotoSansKR-VF.ttf": "9e1d729e7e2b36f9ef439da102f8c134c10aabe46f1c843bf0aca5c043b86f76",
    "Noto-OFL.txt": "6a73f9541c2de74158c0e7cf6b0a58ef774f5a780bf191f2d7ec9cc53efe2bf2",
}
REGIONS = {"ja": "JP", "zh-CN": "SC", "ko": "KR"}
REPOSITORY = Path(__file__).resolve().parents[3]


def verify_source(source):
    for name, expected in SOURCE_HASHES.items():
        actual = sha256((source / name).read_bytes()).hexdigest()
        if actual != expected:
            raise ValueError(f"Unexpected SHA-256 for {name}: {actual}")


def points(paths):
    return {
        ord(character)
        for path in paths
        for character in path.read_text(encoding="utf-8")
    }


def unicode_ranges(codepoints):
    ranges = []
    for _, run in groupby(enumerate(sorted(codepoints)), key=lambda item: item[1] - item[0]):
        values = [value for _, value in run]
        range_end = f"-{values[-1]:X}" if len(values) > 1 else ""
        ranges.append(f"U+{values[0]:X}{range_end}")
    return ",".join(ranges)


def encode_subset(source, codepoints):
    options = subset.Options()
    options.name_IDs = [*range(7), 13, 14, 16, 17, 25]
    # Keep the upstream epoch to make the emitted files reproducible.
    with TTFont(source, recalcTimestamp=False) as font:
        subsetting = subset.Subsetter(options=options)
        subsetting.populate(unicodes=codepoints)
        subsetting.subset(font)
        font.flavor = "woff2"
        output = BytesIO()
        font.save(output)
        return output.getvalue()


def inter_shards(codepoints):
    latin = {
        point
        for point in codepoints
        if point <= 0x36F or 0x1E00 <= point <= 0x1EFF or 0x2000 <= point <= 0x22FF
    }
    cyrillic = {
        point
        for point in codepoints
        if 0x400 <= point <= 0x52F or 0x2DE0 <= point <= 0x2DFF or 0xA640 <= point <= 0xA69F
    }
    return [("latin", latin), ("cyrillic", cyrillic), ("other", codepoints - latin - cyrillic)]


class Output:
    def __init__(self, directory):
        self.directory = directory
        self.fonts = []
        self.rules = {}

    def write(self, name, suffix, data):
        asset = f"{name}.{sha256(data).hexdigest()[:16]}.{suffix}"
        (self.directory / asset).write_bytes(data)
        return asset

    def font(self, family, name, data, codepoints, style="normal"):
        asset = self.write(name, "woff2", data)
        self.fonts.append(asset)
        self.rules.setdefault(family, []).append(
            f'@font-face{{font-family:"{family}";font-weight:100 900;'
            f'font-style:{style};font-display:swap;'
            f'src:url("/assets/fonts/{asset}") format("woff2");'
            f'unicode-range:{unicode_ranges(codepoints)};}}\n'
        )
        print(f"{name}: {len(codepoints)} characters, {len(data)} bytes", flush=True)

    def finish(self):
        def stylesheet(name, family):
            return self.write(name, "css", "".join(self.rules[family]).encode())

        manifest = {
            "stylesheet": stylesheet("inter", "Inter Web"),
            "regional": {
                locale: stylesheet(f"noto-{region.lower()}", f"Noto Sans {region} Web")
                for locale, region in REGIONS.items()
            },
            "fonts": self.fonts,
        }
        (self.directory / "manifest.json").write_text(
            json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
        )


def write_inter(source, output):
    with ZipFile(source / "Inter-4.1.zip") as archive:
        (output.directory / "Inter-OFL.txt").write_bytes(archive.read("LICENSE.txt"))
        inter_points = set()
        for style, suffix in [("normal", ""), ("italic", "-Italic")]:
            data = archive.read(f"web/InterVariable{suffix}.woff2")
            with TTFont(BytesIO(data)) as font:
                codepoints = set(font.getBestCmap())
            if style == "normal":
                inter_points = codepoints
            for label, characters in inter_shards(codepoints):
                output.font(
                    "Inter Web",
                    f"inter-{style}-{label}",
                    encode_subset(BytesIO(data), characters),
                    characters,
                    style,
                )
    return inter_points


def main(source, destination):
    verify_source(source)
    destination.mkdir(parents=True, exist_ok=True)
    output = Output(destination)
    inter_points = write_inter(source, output)
    (destination / "Noto-OFL.txt").write_bytes((source / "Noto-OFL.txt").read_bytes())
    for locale, region in REGIONS.items():
        original = source / f"NotoSans{region}-VF.ttf"
        with TTFont(original, lazy=True) as font:
            coverage = set(font.getBestCmap()) - inter_points
        app = REPOSITORY / "apps" / "admin-web"
        ui = points([*app.glob(f"locales/*/{locale}.json"), app / f"src/editor/locales/{locale}.ts"])
        docs = REPOSITORY / "docs" / "public"
        guide_paths = docs.glob("*.md") if locale == "ja" else (docs / locale).glob("*.md")
        guides = points(guide_paths)
        common = coverage & ui
        guide_only = (coverage & guides) - common
        rest = sorted(coverage - common - guide_only)
        groups = [("ui", common), ("guides", guide_only)]
        groups += [
            (str(index // 1536 + 1), set(rest[index:index + 1536]))
            for index in range(0, len(rest), 1536)
        ]
        family = f"Noto Sans {region} Web"
        for name, codepoints in groups:
            if codepoints:
                output.font(family, f"noto-{region.lower()}-{name}", encode_subset(original, codepoints), codepoints)
    output.finish()


if __name__ == "__main__":
    main(Path(sys.argv[1]), Path(sys.argv[2]))
