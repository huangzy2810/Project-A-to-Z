import {
  createSceneDescriptionHandler,
  createSceneDescriptionProvider,
} from "@/lib/server/scene-description";
import { imageApiKey } from "@/lib/server/image-provider";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;
export const POST = createSceneDescriptionHandler(() => {
  const key = imageApiKey();
  return key ? createSceneDescriptionProvider(key) : undefined;
});
