import {
  Character,
  VisualStyle,
  IllustrationVersion,
  GenerationRecipe,
  uid,
} from "./model";
import { putAsset } from "./storage";
export type GenerationInput = GenerationRecipe;
import { getAsset } from "./storage";
import { assemblePrompt, referenceAssets, MAX_REFERENCES } from "./recipe";
export { assemblePrompt } from "./recipe";
export interface GenerationStatus {
  available: boolean;
  provider: string;
  model: string;
}
export async function generationStatus(
  signal?: AbortSignal,
): Promise<GenerationStatus> {
  const response = await fetch("/api/illustrations", {
    cache: "no-store",
    signal: signal || AbortSignal.timeout(10000),
  });
  if (!response.ok)
    throw new Error(
      "Could not check image generation settings. Please try again.",
    );
  return response.json();
}
export async function illustrationService(
  mode: "auto" | "mock" = "auto",
  onStatus?: (status: GenerationStatus) => void,
): Promise<IllustrationService> {
  if (mode === "mock") return mockIllustrationService;
  const status = await generationStatus();
  onStatus?.(status);
  return status.available ? aiIllustrationService : mockIllustrationService;
}
export const aiIllustrationService: IllustrationService = {
  async generate(input) {
    const references = referenceAssets(input);
    if (references.length > MAX_REFERENCES)
      throw new Error(
        `Use no more than ${MAX_REFERENCES} reference images for one illustration.`,
      );
    const form = new FormData();
    form.append("recipe", JSON.stringify(input));
    for (const reference of references) {
      const blob = await getAsset(reference.id);
      if (blob.size > 8 * 1024 * 1024)
        throw new Error(
          "A reference image is too large. Upload a smaller photo.",
        );
      form.append(
        "images",
        blob,
        `${reference.id}.${blob.type === "image/png" ? "png" : blob.type === "image/webp" ? "webp" : "jpg"}`,
      );
    }
    let response: Response;
    try {
      response = await fetch("/api/illustrations", {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(195000),
      });
    } catch {
      throw new Error(
        "Image generation could not finish. Your previous images are safe. Please try again.",
      );
    }
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new Error(
        body?.error ||
          "Image generation failed. Your previous illustrations are safe.",
      );
    }
    if (!response.headers.get("content-type")?.startsWith("image/png"))
      throw new Error("The image service returned an unreadable illustration.");
    const blob = await response.blob();
    const bitmap = await createImageBitmap(blob);
    const width = bitmap.width,
      height = bitmap.height;
    bitmap.close();
    return {
      id: uid(),
      image: await putAsset(blob),
      prompt: assemblePrompt(input),
      recipe: structuredClone(input),
      characterReferences: input.characters
        .filter((c) => c.status === "locked")
        .map((c) => c.characterSheetImage || c.primaryReferencePhoto || c.id),
      styleReference:
        input.visualStyle.status === "locked"
          ? input.visualStyle.previewImage
          : undefined,
      sceneReferences: input.references,
      model: response.headers.get("X-Illustration-Model") || "openai",
      createdAt: new Date().toISOString(),
      width,
      height,
    };
  },
};
export interface IllustrationService {
  generate(input: GenerationInput): Promise<IllustrationVersion>;
}
// Deterministic integration boundary: a real provider can replace this service later.
export const mockIllustrationService: IllustrationService = {
  async generate(input) {
    await new Promise((r) => setTimeout(r, 650));
    const canvas = document.createElement("canvas");
    canvas.width = 2400;
    canvas.height = 2400;
    const c = canvas.getContext("2d")!;
    const seed = Math.random();
    const sky = c.createLinearGradient(0, 0, 0, 2400);
    sky.addColorStop(0, seed > 0.5 ? "#dbe7df" : "#e8dfd0");
    sky.addColorStop(0.6, "#f4d9b5");
    sky.addColorStop(1, "#f8edda");
    c.fillStyle = sky;
    c.fillRect(0, 0, 2400, 2400);
    c.fillStyle = "#edba87";
    c.beginPath();
    c.arc(1710, 520, 180, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = "#819c99";
    for (let n = 0; n < 13; n++) {
      const x = 90 + n * 190;
      const h = 180 + ((n * 127) % 400);
      c.fillRect(x, 1300 - h, 120, h);
    }
    c.fillStyle = "#729392";
    c.fillRect(1560, 520, 38, 780);
    c.beginPath();
    c.arc(1579, 790, 110, 0, Math.PI * 2);
    c.fill();
    c.beginPath();
    c.arc(1579, 1050, 70, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = "#adc3b7";
    c.beginPath();
    c.ellipse(1200, 1680, 1600, 430, 0, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = "#f8f1d9";
    c.lineWidth = 12;
    for (let n = 0; n < 5; n++) {
      c.beginPath();
      c.moveTo(0, 1490 + n * 80);
      c.bezierCurveTo(
        600,
        1410 + n * 80,
        1300,
        1600 + n * 80,
        2400,
        1500 + n * 80,
      );
      c.stroke();
    }
    const poses =
      input.kind === "character" ? 6 : Math.max(1, input.characters.length);
    for (let n = 0; n < poses; n++) {
      const x =
        input.kind === "character" ? 480 + (n % 3) * 720 : 900 + n * 350;
      const y =
        input.kind === "character" ? 820 + Math.floor(n / 3) * 980 : 1660;
      const adult =
        input.characters[n]?.name !== "Ava" && input.kind !== "character";
      const size = adult ? 1.2 : 1;
      c.save();
      c.translate(x, y);
      c.scale(size, size);
      c.fillStyle = ["#ca846e", "#7d9990", "#c4a36f"][n % 3];
      c.beginPath();
      c.roundRect(-80, 0, 160, 220, 55);
      c.fill();
      c.fillStyle = "#ebc49f";
      c.beginPath();
      c.arc(0, -75, 85, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = "#54473b";
      c.beginPath();
      c.arc(0, -100, 87, Math.PI, Math.PI * 2);
      c.fill();
      c.fillStyle = "#54473b";
      c.beginPath();
      c.arc(-25, -65, 7, 0, Math.PI * 2);
      c.arc(25, -65, 7, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = "#a16b55";
      c.lineWidth = 5;
      c.beginPath();
      c.arc(0, -47, 22, 0, Math.PI);
      c.stroke();
      c.fillStyle = "#54473b";
      c.fillRect(-58, 205, 35, 95);
      c.fillRect(23, 205, 35, 95);
      c.restore();
    }
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) =>
          b
            ? resolve(b)
            : reject(new Error("Could not create the illustration.")),
        "image/png",
      ),
    );
    return {
      recipe: structuredClone(input),
      id: uid(),
      image: await putAsset(blob),
      prompt: assemblePrompt(input),
      characterReferences: input.characters
        .filter((c) => c.status === "locked")
        .map((c) => c.characterSheetImage || c.primaryReferencePhoto || c.id),
      styleReference:
        input.visualStyle.status === "locked"
          ? input.visualStyle.previewImage
          : undefined,
      sceneReferences: input.references,
      model: "mock-canvas-v1",
      width: 2400,
      height: 2400,
      createdAt: new Date().toISOString(),
    };
  },
};
