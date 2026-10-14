import type { GenerationRecipe } from "./model";
export const MAX_REFERENCES = 16;
export interface ReferenceAsset {
  id: string;
  label: string;
}
export function prepareGenerationRecipe(
  input: GenerationRecipe,
): GenerationRecipe {
  if (input.kind !== "style") return input;
  return {
    ...input,
    characters: [],
    scene:
      "An empty Shanghai waterfront landscape with river, skyline and trees. Background only: no people, characters, faces, silhouettes or animals.",
    requiredElements: "Background scenery only",
    exclusions: `people, characters, faces, silhouettes, animals, ${input.exclusions}`,
  };
}
export function referenceAssets(input: GenerationRecipe): ReferenceAsset[] {
  input = prepareGenerationRecipe(input);
  const references: ReferenceAsset[] = [];
  const add = (id: string | undefined, label: string) => {
    if (id && !references.some((r) => r.id === id))
      references.push({ id, label });
  };
  for (const c of input.characters.filter((c) => c.status === "locked")) {
    if (input.kind === "character") {
      add(c.primaryReferencePhoto, `${c.name}: primary identity photo`);
      c.referencePhotos.forEach((id, i) =>
        add(id, `${c.name}: identity photo ${i + 1}`),
      );
    } else {
      add(
        c.characterSheetImage || c.primaryReferencePhoto,
        `${c.name}: approved identity reference`,
      );
      if (!c.characterSheetImage)
        c.referencePhotos.forEach((id, i) =>
          add(id, `${c.name}: identity photo ${i + 1}`),
        );
    }
  }
  if (input.kind === "style" || input.visualStyle.status === "locked") {
    if (input.kind !== "style")
      add(input.visualStyle.previewImage, "Approved visual style sample");
    input.visualStyle.referenceImages.forEach((id, i) =>
      add(id, `Visual style reference ${i + 1}`),
    );
  }
  input.references.forEach((id, i) =>
    add(
      id,
      input.kind === "character"
        ? `Character identity photo ${i + 1}`
        : input.kind === "style"
          ? `Visual style reference ${i + 1}`
          : `Scene reference ${i + 1}`,
    ),
  );
  return references;
}
export function assemblePrompt(input: GenerationRecipe): string {
  input = prepareGenerationRecipe(input);
  const references = referenceAssets(input);
  return [
    "Create one square children’s storybook illustration. Render artwork only; story text is added separately.",
    input.kind === "character"
      ? "Generate exactly one face-only identity portrait in the approved illustration style. Show the face, natural hair and ears, cropped tightly below the chin, on a plain neutral background. No neck, shoulders, torso, full body, clothing, collars, hats, jewelry, accessories, props, scenery, additional people or labels. Extract facial identity from uploaded photos and ignore their clothing and surroundings. Facial identity takes precedence over any clothing or non-face details in the description."
      : input.kind === "style"
        ? "Create an uninhabited background-only sample of the requested illustration style. No people, characters, faces, silhouettes or animals, even if they appear in uploaded style references."
        : "Illustrate this story scene with only the requested characters.",
    ...input.characters.map((c) =>
      c.status === "locked"
        ? `Preserve character identity: ${c.name}${input.kind === "scene" ? "" : `, ${c.description}`}. Keep facial features, hairstyle, approximate age and facial proportions consistent with their attached references.`
        : `Character: ${c.name}, ${c.description}.`,
    ),
    ...(input.kind === "scene"
      ? [
          "CHARACTER IDENTITY CONTRACT: The approved character sheets are the source of truth for identity. Draw each selected person once unless the scene explicitly requires otherwise. Keep each face, hair, skin tone, approximate age and distinctive facial features unchanged. Never exchange identities between characters or invent substitute faces.",
          ...input.characters.map((c, index) => {
            const canonical =
              references.findIndex((r) => r.id === c.characterSheetImage) + 1;
            return `Character ${index + 1}: ${c.name}. Canonical identity = Image ${canonical}. Use only the approved face's facial identity, hair and skin tone. Do not copy clothing, accessories, body poses or background elements from identity references.`;
          }),
          "Reference hierarchy: canonical face references govern facial identity only; clothing, outfits and accessories must come from the chapter scene and scene references, never from character identity images; approved style governs medium, palette and texture only; scene photographs govern setting and composition only. Never borrow faces or people from style or scene references. Verify every selected character against their assigned sheet before completing the image.",
        ]
      : []),
    `Visual style: ${input.visualStyle.description}`,
    input.kind !== "style" && input.visualStyle.status === "locked"
      ? "Match the attached approved style sample across every character, background and object; preserve its palette, medium, texture and linework. Approved style takes precedence over the photographic appearance of identity and scene references."
      : "",
    `Scene: ${input.scene}`,
    `Composition: ${input.composition || "Leave generous negative space at the bottom for story text."}`,
    `Required elements: ${input.requiredElements || "none"}`,
    "Reference images are attached in exactly this order:",
    ...references.map((r, i) => `Image ${i + 1}: ${r.label}.`),
    references.length
      ? "Use identity images only for likeness, style images only for visual treatment, and scene images for location, clothing, objects or pose. Render reference-photo subjects in the approved illustration style, not as photographs. Do not introduce characters shown in scene or style references unless they are explicitly selected for this page."
      : "No image references supplied; follow the descriptions.",
    `Exclude: text, lettering, watermarks, extra limbs, unintended duplicate characters, ${input.exclusions || "unrelated foreground objects"}.`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function generationApprovalIssues(input: GenerationRecipe): string[] {
  if (input.kind !== "scene" && input.kind !== "character") return [];
  const issues: string[] = [];
  if (input.visualStyle.status !== "locked" || !input.visualStyle.previewImage)
    issues.push(
      input.kind === "character"
        ? "Generate and lock a visual style before generating a character sheet."
        : "Generate and lock a visual style before illustrating a story page.",
    );
  for (const character of input.kind === "scene" ? input.characters : []) {
    if (character.status !== "locked" || !character.characterSheetImage)
      issues.push(
        `Generate and lock ${character.name} in Character Studio before using them on this page.`,
      );
  }
  return issues;
}

export function sceneApprovalIssues(input: GenerationRecipe): string[] {
  return input.kind === "scene" ? generationApprovalIssues(input) : [];
}

export function retryIdentityIssues(
  recipe: GenerationRecipe | undefined,
  current: GenerationRecipe["characters"],
): string[] {
  if (!recipe)
    return [
      "This version has no saved identity recipe. Use Edit & Regenerate with the current approved characters.",
    ];
  return recipe.characters.flatMap((previous) => {
    const character = current.find((c) => c.id === previous.id);
    if (
      !character ||
      character.status !== "locked" ||
      !character.characterSheetImage
    )
      return [
        `${previous.name} no longer has an approved character sheet. Lock their character in Character Studio before regenerating.`,
      ];
    if (
      character.characterSheetImage !== previous.characterSheetImage ||
      character.primaryReferencePhoto !== previous.primaryReferencePhoto ||
      character.name !== previous.name ||
      character.description !== previous.description
    )
      return [
        `${character.name}'s approved identity has changed. Use Edit & Regenerate to apply the current Character Studio reference.`,
      ];
    return [];
  });
}
export function unselectedSceneCharacters(
  scene: string,
  characters: GenerationRecipe["characters"],
  selectedIds: string[],
): string[] {
  return characters
    .filter((c) => !selectedIds.includes(c.id) && c.name.trim())
    .filter((c) => {
      const escape = String.fromCharCode(92);
      const name = Array.from(c.name.trim())
        .map((letter) =>
          (".*+?^${}()|[]" + escape).includes(letter)
            ? escape + letter
            : letter,
        )
        .join("");
      return new RegExp(
        `(^|[^\p{L}\p{N}])${name}(?=$|[^\p{L}\p{N}])`,
        "iu",
      ).test(scene);
    })
    .map((c) => c.name);
}
