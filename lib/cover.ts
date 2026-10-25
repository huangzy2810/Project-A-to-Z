import type { BookProject, CoverDesign, GenerationRecipe } from "./model";
export const emptyCover = (): CoverDesign => ({
  instructions: "",
  characterIds: [],
  referencePhotos: [],
  illustrationVersions: [],
});
export function coverRecipe(project: BookProject): GenerationRecipe {
  const cover = project.cover || emptyCover();
  if (!cover.instructions.trim() && !cover.referencePhotos.length)
    throw new Error("Upload a cover photo or write cover instructions first.");
  return {
    kind: "cover",
    characters: (cover.characterIds || []).map((id) => {
      const character = project.characters.find((c) => c.id === id);
      if (!character)
        throw new Error(
          "A selected character is missing from Character Studio. Update the cover cast before generating.",
        );
      return character;
    }),
    visualStyle: project.visualStyle,
    scene:
      cover.instructions.trim() ||
      "Create a warm, inviting family adventure book cover based on the uploaded photos.",
    references: [...cover.referencePhotos],
    composition: `Square full-cover artwork. Keep the main subjects in the upper two thirds, with quiet negative space in the lower third for the app's book title and subtitle. Typography layout reference: heading font ${project.typography.headingFont}, heading size ${project.typography.headingSize}; body font ${project.typography.bodyFont}, body size ${project.typography.bodySize}; line height ${project.typography.lineHeight}, alignment ${project.typography.alignment}, text color ${project.typography.textColor}. Compose artwork to complement this typography and preserve readable title space. These settings guide layout only; do not draw any text.`,
    exclusions: "lettering, captions, watermarks",
    requiredElements: "Inviting cover composition",
  };
}
export function selectedCoverVersion(project: BookProject) {
  return project.cover?.illustrationVersions.find(
    (v) => v.id === project.cover?.selectedIllustrationId,
  );
}
