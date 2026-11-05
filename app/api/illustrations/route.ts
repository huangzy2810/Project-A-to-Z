import { createIllustrationHandler } from "@/lib/server/illustration-handler";
import {
  createOpenAIProvider,
  imageApiKey,
  IMAGE_MODEL,
  CHARACTER_IMAGE_MODEL,
} from "@/lib/server/image-provider";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;
export async function GET() {
  return Response.json(
    {
      available: Boolean(imageApiKey()),
      provider: "OpenAI",
      model: IMAGE_MODEL,
      models: {
        character: CHARACTER_IMAGE_MODEL,
        scene: IMAGE_MODEL,
        style: IMAGE_MODEL,
        cover: IMAGE_MODEL,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
export const POST = createIllustrationHandler(() => {
  const key = imageApiKey();
  return key ? createOpenAIProvider(key) : undefined;
});
