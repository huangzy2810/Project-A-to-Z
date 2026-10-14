export interface ImageRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}
export function validRegion(region: ImageRegion) {
  return (
    [region.x, region.y, region.width, region.height].every(Number.isFinite) &&
    region.x >= 0 &&
    region.y >= 0 &&
    region.width > 0 &&
    region.height > 0 &&
    region.x + region.width <= 1.000001 &&
    region.y + region.height <= 1.000001
  );
}
export function pixelRegion(
  region: ImageRegion,
  width: number,
  height: number,
) {
  if (
    !validRegion(region) ||
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1
  )
    throw new Error("Select a valid area inside the illustration.");
  const x = Math.min(width - 1, Math.floor(region.x * width)),
    y = Math.min(height - 1, Math.floor(region.y * height));
  return {
    x,
    y,
    width: Math.min(
      width - x,
      Math.max(1, Math.ceil((region.x + region.width) * width) - x),
    ),
    height: Math.min(
      height - y,
      Math.max(1, Math.ceil((region.y + region.height) * height) - y),
    ),
  };
}
