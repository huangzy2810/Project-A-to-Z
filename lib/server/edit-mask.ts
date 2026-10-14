import sharp from "sharp";
import { ImageRegion, pixelRegion } from "../regions";
import { ImageGenerationError } from "./image-provider";
export async function editMask(
  original: File,
  region: ImageRegion,
): Promise<File> {
  try {
    const bytes = Buffer.from(await original.arrayBuffer());
    const metadata = await sharp(bytes, {
      limitInputPixels: 2400 * 2400,
    }).metadata();
    const width = metadata.width,
      height = metadata.height;
    if (!width || !height || width !== height || width > 2400)
      throw new Error("Invalid illustration dimensions");
    const r = pixelRegion(region, width, height);
    const rgba = Buffer.alloc(width * height * 4, 255);
    for (let y = r.y; y < r.y + r.height; y++)
      rgba.fill(0, (y * width + r.x) * 4, (y * width + r.x + r.width) * 4);
    const mask = await sharp(rgba, { raw: { width, height, channels: 4 } })
      .png()
      .toBuffer();
    if (mask.length >= 4 * 1024 * 1024)
      throw new Error("Mask exceeds provider limit");
    return new File([Uint8Array.from(mask)], "edit-mask.png", {
      type: "image/png",
    });
  } catch {
    throw new ImageGenerationError(
      400,
      "The original illustration or selected area could not be read. Choose a valid square illustration and mark an area inside it.",
    );
  }
}
