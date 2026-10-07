import { z } from "zod";
import { assemblePrompt, referenceAssets, MAX_REFERENCES } from "../recipe";
import { ImageGenerationError, type ImageProvider } from "./image-provider";
const id = z.string().min(1).max(100);
const ids = z.array(id).max(MAX_REFERENCES);
const status = z.enum(["draft", "locked"]);
const text = z.string().max(5000);
const recipeSchema = z.object({
  characters: z
    .array(
      z.object({
        id,
        name: z.string().min(1).max(120),
        relationship: z.string().max(200),
        description: text,
        referencePhotos: ids,
        primaryReferencePhoto: id.optional(),
        characterSheetImage: id.optional(),
        generatedPrompt: z.string().max(25000).optional(),
        status,
      }),
    )
    .max(12),
  visualStyle: z.object({
    description: text,
    referenceImages: ids,
    generatedStylePrompt: z.string().max(25000),
    previewImage: id.optional(),
    status,
  }),
  scene: z.string().trim().min(1).max(5000),
  references: ids,
  composition: text,
  requiredElements: text.optional(),
  exclusions: text,
  kind: z.enum(["character", "style", "scene"]).optional(),
});
const MAX_BODY = 28 * 1024 * 1024;
const MAX_FILE = 8 * 1024 * 1024;
function errorResponse(status: number, message: string) {
  return Response.json(
    { error: message },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}
async function limitedForm(request: Request) {
  if (Number(request.headers.get("content-length")) > MAX_BODY)
    throw new ImageGenerationError(
      413,
      "Reference photos are too large. Use fewer or smaller photos.",
    );
  const type = request.headers.get("content-type") || "";
  if (!type.startsWith("multipart/form-data;"))
    throw new ImageGenerationError(
      400,
      "Image generation needs a valid photo upload request.",
    );
  const reader = request.body?.getReader();
  if (!reader)
    throw new ImageGenerationError(
      400,
      "No illustration request was supplied.",
    );
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_BODY) {
      await reader.cancel();
      throw new ImageGenerationError(
        413,
        "Reference photos are too large. Use fewer or smaller photos.",
      );
    }
    chunks.push(value);
  }
  return new Response(new Blob(chunks), {
    headers: { "Content-Type": type },
  }).formData();
}
async function verifyImage(file: File) {
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const png =
    bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71;
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const webp =
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  if (!(
    (file.type === "image/png" && png) ||
    (file.type === "image/jpeg" && jpeg) ||
    (file.type === "image/webp" && webp)
  ))
    throw new ImageGenerationError(
      400,
      "A reference photo is not a valid JPG, PNG or WEBP image.",
    );
}
export function createIllustrationHandler(
  getProvider: () => ImageProvider | undefined,
) {
  let inFlight = false;
  return async function handle(request: Request): Promise<Response> {
    const origin = request.headers.get("origin");
    const host = request.headers.get("host") || new URL(request.url).host;
    let sameOrigin = false;
    try {
      const parsed = new URL(origin || "");
      sameOrigin =
        ["http:", "https:"].includes(parsed.protocol) && parsed.host === host;
    } catch {
      /* Invalid or missing origins are rejected. */
    }
    if (!sameOrigin || request.headers.get("sec-fetch-site") === "cross-site")
      return errorResponse(
        403,
        "Please generate illustrations from the book editor.",
      );
    if (inFlight)
      return errorResponse(
        429,
        "Another illustration is being generated. Wait for it to finish before trying again.",
      );
    inFlight = true;
    try {
      const provider = getProvider();
      if (!provider)
        return errorResponse(
          503,
          "AI generation is not configured yet. Add IMAGE_API_KEY in server settings or choose sample artwork.",
        );
      const form = await limitedForm(request);
      const metadata = form.get("recipe");
      if (typeof metadata !== "string" || metadata.length > 100000)
        throw new ImageGenerationError(
          400,
          "The illustration request is invalid.",
        );
      const result = recipeSchema.safeParse(JSON.parse(metadata));
      if (!result.success)
        throw new ImageGenerationError(
          400,
          "The illustration request contains invalid or oversized story details.",
        );
      const recipe = result.data;
      const references = referenceAssets(recipe);
      if (references.length > MAX_REFERENCES)
        throw new ImageGenerationError(
          400,
          `Use no more than ${MAX_REFERENCES} reference images for one illustration.`,
        );
      const files = form.getAll("images");
      if (
        files.length !== references.length ||
        files.some((f) => !(f instanceof File))
      )
        throw new ImageGenerationError(
          400,
          "Some reference images are missing. Upload them again before generating.",
        );
      const images = files as File[];
      for (const image of images) {
        if (!image.size || image.size > MAX_FILE)
          throw new ImageGenerationError(
            413,
            "Each reference image must be smaller than 8 MB.",
          );
        await verifyImage(image);
      }
      const signal = AbortSignal.any([
        request.signal,
        AbortSignal.timeout(180000),
      ]);
      const prompt = assemblePrompt(recipe);
      if (prompt.length > 32000)
        throw new ImageGenerationError(
          400,
          "These story and character details are too long. Shorten them before generating.",
        );
      const illustration = await provider.generate(prompt, images, signal);
      return new Response(
        new Blob([Uint8Array.from(illustration.bytes)], { type: "image/png" }),
        {
          headers: {
            "Content-Type": "image/png",
            "Cache-Control": "no-store",
            "X-Illustration-Model": illustration.model,
            "X-Content-Type-Options": "nosniff",
          },
        },
      );
    } catch (error) {
      if (error instanceof ImageGenerationError)
        return errorResponse(error.status, error.message);
      if (error instanceof SyntaxError || error instanceof TypeError)
        return errorResponse(
          400,
          "The illustration request could not be read. Please try again.",
        );
      return errorResponse(
        502,
        "Image generation failed. Your existing illustrations have been kept.",
      );
    } finally {
      inFlight = false;
    }
  };
}
