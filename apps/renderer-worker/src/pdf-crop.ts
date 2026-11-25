import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { PdfCropRequest } from "@latex-renderer/contracts";
import { AppError } from "@latex-renderer/shared";

export function pdfCropProgram(crop: PdfCropRequest): string {
  // All interpolated arguments are bounded numbers validated against the shared
  // crop schema. The PDF is selected by the Worker, never by shell input.
  return String.raw`
umask 0007
export LC_ALL=C.UTF-8
pdf=/work/pdf/result.pdf
page=${crop.page}
x_fraction=${crop.x.toFixed(6)}
y_fraction=${crop.y.toFixed(6)}
w_fraction=${crop.width.toFixed(6)}
h_fraction=${crop.height.toFixed(6)}
cd /work/output
timeout -k 2 8 pdfinfo -f "$page" -l "$page" -box "$pdf" > /tmp/crop-geometry
awk -v page="$page" -v fx="$x_fraction" -v fy="$y_fraction" -v fw="$w_fraction" -v fh="$h_fraction" '
    $1=="Page" && $2==page && $3=="CropBox:" { w=$6-$4; h=$7-$5; printed=1 }
    $1=="Page" && $2==page && $3=="rot:" { rot=$4 }
    END {
      if (!printed || w<=0 || h<=0 || w>12000 || h>12000) exit 1;
      if (rot==90 || rot==270) { t=w; w=h; h=t; }
      longest=(w*fw > h*fh ? w*fw : h*fh);
      dpi=int(57600/longest);
      if (dpi>600) dpi=600;
      if (dpi<4) dpi=4;
      scale=dpi/72;
      pw=int(w*scale+0.99999); ph=int(h*scale+0.99999);
      x=int(pw*fx); y=int(ph*fy);
      x2=int(pw*(fx+fw)+0.99999); y2=int(ph*(fy+fh)+0.99999);
      if (x2>pw) x2=pw; if (y2>ph) y2=ph;
      if (x2<=x || y2<=y || x2-x>1000 || y2-y>1000) exit 1;
      printf "%d %d %d %d %d %d %.3f %.3f\n",dpi,x,y,x2-x,y2-y,rot,w,h;
    }
  ' /tmp/crop-geometry > geometry
read -r dpi x y w h rotation points_w points_h < geometry
timeout -k 2 15 pdftoppm -f "$page" -l "$page" -cropbox -r "$dpi" \
  -x "$x" -y "$y" -W "$w" -H "$h" -singlefile -jpeg \
  -jpegopt quality=82 "$pdf" crop
if [ "$(wc -c < crop.jpg)" -gt 40000 ]; then
  timeout -k 2 8 convert crop.jpg -resize 600x600\> -quality 69 resized.jpg
  mv resized.jpg crop.jpg
fi
timeout -k 2 8 identify -format '%w %h' crop.jpg > pixels
`;
}

export async function readPdfCrop(directory: string, crop: PdfCropRequest) {
  const metadata = async (name: string) => {
    const path = join(directory, name);
    const stat = await lstat(path);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > 256)
      throw new Error("Invalid crop geometry output");
    return (await readFile(path, "utf8")).trim().split(/\s+/).map(Number);
  };
  const [dpi, x, y, width, height, rotation, pointsWide, pointsHigh] =
    await metadata("geometry");
  const [pixelWidth, pixelHeight] = await metadata("pixels");
  const path = join(directory, "crop.jpg");
  const stat = await lstat(path);
  if (!stat.isFile() || stat.nlink !== 1 || stat.size > 40_000)
    throw new AppError(
      "PDF_CROP_OUTPUT_LIMIT",
      "Crop exceeds the inline image limit",
      409,
    );
  const image = await readFile(path);
  if (
    image[0] !== 0xff ||
    image[1] !== 0xd8 ||
    [
      dpi,
      x,
      y,
      width,
      height,
      rotation,
      pointsWide,
      pointsHigh,
      pixelWidth,
      pixelHeight,
    ].some((value) => typeof value !== "number" || !Number.isFinite(value))
  )
    throw new Error("Invalid PDF crop output");
  return {
    page: crop.page,
    normalizedCrop: crop,
    cropPixels: { x, y, width, height },
    displayPagePoints: { width: pointsWide, height: pointsHigh },
    rotation,
    dpi,
    pixelWidth,
    pixelHeight,
    mimeType: "image/jpeg",
    sha256: createHash("sha256").update(image).digest("hex"),
    base64: image.toString("base64"),
  };
}
