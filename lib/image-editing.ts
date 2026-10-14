import { ImageRegion, pixelRegion } from "./regions";
async function png(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new Error("Could not save the image edit.")),
      "image/png",
    ),
  );
}
export async function compositeTweak(
  original: Blob,
  generated: Blob,
  region: ImageRegion,
): Promise<Blob> {
  const base = await createImageBitmap(original);
  let patch: ImageBitmap | undefined;
  try {
    patch = await createImageBitmap(generated);
    const canvas = document.createElement("canvas");
    canvas.width = base.width;
    canvas.height = base.height;
    const context = canvas.getContext("2d")!;
    context.drawImage(base, 0, 0);
    const r = pixelRegion(region, base.width, base.height);
    context.save();
    context.beginPath();
    context.rect(r.x, r.y, r.width, r.height);
    context.clip();
    context.clearRect(r.x, r.y, r.width, r.height);
    context.drawImage(patch, 0, 0, canvas.width, canvas.height);
    context.restore();
    return await png(canvas);
  } finally {
    base.close();
    patch?.close();
  }
}
export async function sampleTweak(
  original: Blob,
  region: ImageRegion,
): Promise<Blob> {
  const base = await createImageBitmap(original);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = base.width;
    canvas.height = base.height;
    const context = canvas.getContext("2d")!;
    context.drawImage(base, 0, 0);
    const r = pixelRegion(region, base.width, base.height);
    context.fillStyle = "rgba(83,125,94,0.35)";
    context.fillRect(r.x, r.y, r.width, r.height);
    return await png(canvas);
  } finally {
    base.close();
  }
}
