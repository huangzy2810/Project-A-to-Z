import type { BookProject, CoverDesign, GenerationRecipe } from "./model";
export const emptyCover = (): CoverDesign => ({
  instructions: "",
  referencePhotos: [],
  illustrationVersions: [],
});
export function coverRecipe(project: BookProject): GenerationRecipe {
  const cover = project.cover || emptyCover();
  if (!cover.instructions.trim() && !cover.referencePhotos.length)
    throw new Error("Upload a cover photo or write cover instructions first.");
  return {
    kind: "cover",
    characters: [],
    visualStyle: project.visualStyle,
    scene:
      cover.instructions.trim() ||
      "Create a warm, inviting family adventure book cover based on the uploaded photos.",
    references: [...cover.referencePhotos],
    composition:
      "Square full-cover artwork. Keep the main subjects in the upper two thirds, with quiet negative space in the lower third for the app's book title and subtitle.",
    exclusions: "lettering, captions, watermarks",
    requiredElements: "Inviting cover composition",
  };
}
export function selectedCoverVersion(project: BookProject) {
  return project.cover?.illustrationVersions.find(
    (v) => v.id === project.cover?.selectedIllustrationId,
  );
}
