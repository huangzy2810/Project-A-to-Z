import { getAsset } from "./storage";
export const MAX_SCENE_PHOTOS = 4;
export async function describeScenePhotos(
  photoIds: string[],
  characterNames: string[],
): Promise<string> {
  if (!photoIds.length || photoIds.length > MAX_SCENE_PHOTOS)
    throw new Error(
      `Choose between 1 and ${MAX_SCENE_PHOTOS} scene photos for a draft.`,
    );
  const form = new FormData();
  form.set("characters", JSON.stringify(characterNames));
  for (const id of photoIds) {
    const photo = await getAsset(id);
    if (photo.size > 8 * 1024 * 1024)
      throw new Error("Use scene photos smaller than 8 MB.");
    form.append("photos", photo, "scene.jpg");
  }
  let response: Response;
  try {
    response = await fetch("/api/scene-description", {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(95000),
    });
  } catch {
    throw new Error(
      "Photo analysis could not finish. Your photos and scene text are safe. Try drafting again.",
    );
  }
  const data = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(
      data?.error ||
        "Could not describe these photos. Your scene text is safe.",
    );
  if (
    typeof data?.description !== "string" ||
    !data.description.trim() ||
    data.description.length > 5000
  )
    throw new Error(
      "Photo analysis returned an unreadable draft. Your scene text is safe.",
    );
  return data.description.trim();
}
