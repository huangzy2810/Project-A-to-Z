import {
  angleApproved,
  angleIdentityIssues,
  angleReference,
  ANGLE_LABELS,
  identityImage,
} from "./character-angles";
import type { GenerationRecipe } from "./model";
export const MAX_REFERENCES = 16;
export interface ReferenceAsset {
  id: string;
  label: string;
  role: "identity" | "style" | "scene-layout" | "cover" | "original";
}
export function prepareGenerationRecipe(
  input: GenerationRecipe,
): GenerationRecipe {
  // Keep image bindings and approvals, not portrait histories/prompts repeated per cast member.
  input = {
    ...input,
    characters: input.characters.map((character) => {
      const { generatedPrompt: _generatedPrompt, ...snapshot } = character;
      return {
        ...snapshot,
        ...(character.angleReferences
          ? {
              angleReferences: Object.fromEntries(
                Object.entries(character.angleReferences).map(
                  ([angle, reference]) => {
                    const {
                      generatedPrompt: _prompt,
                      generationModel: _model,
                      previousImages: _images,
                      ...binding
                    } = reference!;
                    return [angle, binding];
                  },
                ),
              ),
            }
          : {}),
      };
    }),
  };
  if (input.kind === "scene" || !input.kind)
    return { ...input, kind: "scene", references: [] };
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
  const add = (
    id: string | undefined,
    label: string,
    role: ReferenceAsset["role"],
  ) => {
    if (id && !references.some((r) => r.id === id))
      references.push({ id, label, role });
  };
  for (const c of input.characters.filter((c) => c.status === "locked")) {
    if (input.kind === "character" && input.characterAngle) {
      const angle = input.characterAngle;
      const ref = angleReference(c, angle);
      if (angle !== "front")
        add(
          c.angleReferences?.front?.image,
          `${c.name}: approved Front identity anchor`,
          "identity",
        );
      add(
        ref.primaryReferencePhoto,
        `${c.name}: primary ${ANGLE_LABELS[angle]} identity photo`,
        "identity",
      );
      ref.referencePhotos.forEach((id, i) =>
        add(
          id,
          `${c.name}: ${ANGLE_LABELS[angle]} identity photo ${i + 1}`,
          "identity",
        ),
      );
    } else if (input.kind === "character") {
      add(
        c.primaryReferencePhoto,
        `${c.name}: primary identity photo`,
        "identity",
      );
      c.referencePhotos.forEach((id, i) =>
        add(id, `${c.name}: identity photo ${i + 1}`, "identity"),
      );
    } else {
      add(
        identityImage(c, input.characterFacing?.[c.id]) ||
          (!c.angleReferences ? c.primaryReferencePhoto : undefined),
        c.angleReferences
          ? `${c.name}: approved ${ANGLE_LABELS[input.characterFacing?.[c.id] || "front"]} portrait`
          : `${c.name}: approved identity reference`,
        "identity",
      );
    }
  }
  if (input.kind === "style" || input.visualStyle.status === "locked") {
    if (input.kind !== "style")
      add(
        input.visualStyle.previewImage,
        "Approved visual style sample",
        "style",
      );
    input.visualStyle.referenceImages.forEach((id, i) =>
      add(id, `Visual style reference ${i + 1}`, "style"),
    );
  }
  input.references.forEach((id, i) =>
    add(
      id,
      input.kind === "character"
        ? `Character identity photo ${i + 1}`
        : input.kind === "style"
          ? `Visual style reference ${i + 1}`
          : input.kind === "cover"
            ? `Cover photo reference ${i + 1}: clothing, poses and setting; approved characters govern identity`
            : `Scene reference ${i + 1} (background, placement and clothing only)`,
      input.kind === "character"
        ? "identity"
        : input.kind === "style"
          ? "style"
          : input.kind === "cover"
            ? "cover"
            : "scene-layout",
    ),
  );
  return references;
}
export function assemblePrompt(input: GenerationRecipe): string {
  input = prepareGenerationRecipe(input);
  const references = referenceAssets(input);
  const offset = input.tweak ? 1 : 0;
  return [
    input.tweak
      ? "Repair Image 1 only in the transparent area of the supplied mask. Keep the original composition, lighting, story meaning and visual style. Return the complete illustration at the same square framing, changing only the marked area. No lettering or story text."
      : input.kind === "cover"
        ? "Create one square children's storybook front-cover illustration. Artwork only: no title, subtitle, letters or watermarks. The app lays out the book title and subtitle separately."
        : "Create one square children’s storybook illustration. Render artwork only; story text is added separately.",
    ...(input.tweak
      ? [
          `Requested local change: ${input.tweak.feedback}`,
          `Marked area: x ${Math.round(input.tweak.region.x * 100)}%, y ${Math.round(input.tweak.region.y * 100)}%, width ${Math.round(input.tweak.region.width * 100)}%, height ${Math.round(input.tweak.region.height * 100)}%. Preserve everything outside it.`,
        ]
      : []),
    input.kind === "character" && input.characterAngle
      ? `Create exactly one large ${ANGLE_LABELS[input.characterAngle]} face-only identity portrait, never a multi-view sheet or grid. ${input.characterAngle === "front" ? "Face directly toward the viewer with both sides of the face visible. Extract identity from the front photos; ignore their clothing and surroundings." : input.characterAngle === "three-quarter" ? "Turn the head approximately 45 degrees; both eyes remain visible. Preserve the approved front portrait's identity while using angle photos for geometry." : `The nose must point to the ${input.characterAngle === "left-profile" ? "left" : "right"} edge of the image from the viewer's perspective, in a full side profile; do not mirror facial asymmetries. Preserve the approved front identity and use the angle photos for forehead, nose, lips, chin, ear placement and hairline.`} Show only face, natural hair and ears, cropped tightly below the chin on a plain neutral background. No neck, shoulders, torso, full body, clothing, collars, hats, jewelry, accessories, props, scenery, additional people or labels. The approved front portrait governs identity; photos assigned to this angle govern pose and profile geometry. If angle photos are absent, infer the requested angle from the approved front portrait without changing the person. Use the separately approved visual style.`
      : input.kind === "character"
        ? "Create a canonical face-only identity sheet in a clean 2 × 2 grid. Show exactly four tightly cropped views of the same person: front, three-quarter, side profile, and front smiling. Keep facial identity, age, hair and skin tone identical across all four views. Show only face, natural hair and ears, cropped tightly below the chin, on a plain neutral background. No neck, shoulders, torso, full body, clothing, collars, hats, jewelry, accessories, props, scenery, additional people or labels. Extract facial identity from uploaded photos and ignore their clothing and surroundings. Facial identity takes precedence over any clothing or non-face details in the description."
        : input.kind === "style"
          ? "Create an uninhabited background-only sample of the requested illustration style. No people, characters, faces, silhouettes or animals, even if they appear in uploaded style references."
          : input.kind === "cover"
            ? "Create an inviting cover guided by the supplied photos and freeform instructions. Render only the selected cast listed below; do not add unselected characters or extra people from cover photos. If the cast is empty, create a cover without people. Cover photos guide clothing, poses, composition and setting. When approved character sheets are attached, they exclusively govern the named characters’ facial identity, hair, age and skin tone; cover photos must not replace or alter these identities. When the selected cast is empty, use cover photos for the environment and composition only; omit all people. Preserve key photo details unless the instructions request changes. Style references govern visual treatment only; do not copy people from style references. Leave quiet space in the lower third for the book title and subtitle."
            : "Illustrate this story scene with only the requested characters.",
    ...input.characters.map((c) =>
      c.status === "locked"
        ? `Preserve character identity: ${c.name}, ${c.description}. Keep facial features, hairstyle, approximate age and facial proportions consistent with their attached references.`
        : `Character: ${c.name}, ${c.description}.`,
    ),
    ...(input.kind === "scene" ||
    (input.kind === "cover" && input.characters.length > 0)
      ? [
          "CHARACTER IDENTITY CONTRACT: The approved character sheets are the source of truth for identity. Draw each selected person once unless the scene explicitly requires otherwise. Keep each face, hair, skin tone, approximate age and distinctive facial features unchanged. Never exchange identities between characters or invent substitute faces. The multiple views on a reference sheet depict one person; never reproduce the sheet’s grid or extra views in a story illustration.",
          ...input.characters.map((c, index) => {
            const canonical =
              references.findIndex(
                (r) => r.id === identityImage(c, input.characterFacing?.[c.id]),
              ) +
              1 +
              offset;
            return `Character ${index + 1}: ${c.name}. Canonical identity = Image ${canonical}. ${input.characterFacing?.[c.id] ? `Required head direction: ${ANGLE_LABELS[input.characterFacing[c.id]]}. This explicit facing choice takes priority over conflicting head angles in scene text. Left/right refer to the direction the nose points in the image. Match Image ${canonical} for the head angle. This is the only character reference image for ${c.name}; do not turn a requested profile toward the camera. Keep facial asymmetries rather than simply mirroring the opposite profile. ` : ""}Use only the approved face's facial identity, hair and skin tone. Do not copy clothing, accessories, body poses or background elements from identity references.`;
          }),
          "Reference hierarchy: canonical face references govern facial identity only; clothing, outfits and accessories may come from scene photographs, while explicit written scene descriptions and required elements take priority; never copy clothing from character identity images; approved style governs medium, palette and texture only; scene photographs govern backgrounds, objects, camera framing, character placement and clothing only. Never borrow faces or people from style or scene references. Verify every selected character against their assigned sheet before completing the image.",
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
    ...(input.tweak
      ? [
          "Image 1: Original illustration to repair. The mask applies to this image only.",
        ]
      : []),
    ...references.map((r, i) => `Image ${i + 1 + offset}: ${r.label}.`),
    ...references.flatMap((r, i) =>
      r.role === "scene-layout"
        ? [
            `SCENE-ONLY REFERENCE — Image ${i + 1 + offset}: use background, architecture, environment, objects, perspective, spatial placement and clothing. Photographed people may supply position, scale, outfits and accessories only, never identity. Discard their faces, hair, skin tone, age, gender and body shape. Dress the selected approved characters in the referenced clothing without copying the photographed wearer. Match outfits to named characters using the written scene; if the mapping is ambiguous, follow the written clothing description rather than guessing an identity. Derive every face and hairstyle exclusively from its numbered approved identity sheet. Source-photo crowds do not determine the story cast. Explicit written scene instructions override source-photo clothing and placement.`,
          ]
        : [],
    ),
    input.kind === "cover"
      ? "Use approved character sheets as the source of truth for the requested cast’s identity. Cover photos guide clothing, poses and setting, and must never introduce unselected people or substitute identities. Use approved style images only for visual treatment. Keep photographic subjects in the chosen illustration style. Follow written cover instructions; never render story text, captions or lettering."
      : references.length
        ? "Use approved identity images exclusively for facial identity, hair, skin tone and age, and style images only for visual treatment. Use scene images for backgrounds, spatial placement and clothing, never photographed people’s likeness or physical features. Transfer garments and accessories onto the approved cast without copying the wearer’s identity. Render only selected approved characters. Explicit written outfits and actions take priority."
        : "No image references supplied; follow the descriptions.",
    `Exclude: text, lettering, watermarks, extra limbs, unintended duplicate characters, ${input.exclusions || "unrelated foreground objects"}.`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function generationApprovalIssues(input: GenerationRecipe): string[] {
  if (
    input.kind !== "scene" &&
    input.kind !== "character" &&
    input.kind !== "cover"
  )
    return [];
  const issues: string[] = [];
  if (
    input.kind !== "cover" &&
    (input.visualStyle.status !== "locked" || !input.visualStyle.previewImage)
  )
    issues.push(
      input.kind === "character"
        ? "Generate and lock a visual style before generating a character sheet."
        : "Generate and lock a visual style before illustrating a story page.",
    );
  if (input.kind === "character" && input.characterAngle) {
    for (const character of input.characters) {
      if (
        input.characterAngle === "front" &&
        !angleReference(character, "front").referencePhotos.length
      )
        issues.push("Upload a Front source photo first.");
      if (
        input.characterAngle !== "front" &&
        !angleApproved(character, "front")
      )
        issues.push(
          "Approve the Front portrait before generating other angles.",
        );
    }
  }
  for (const character of input.kind === "scene" || input.kind === "cover"
    ? input.characters
    : []) {
    issues.push(
      ...angleIdentityIssues(
        character,
        input.characterFacing?.[character.id] || "front",
      ),
    );
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
    const angle = recipe.characterFacing?.[previous.id] || "front";
    const angleIssues = angleIdentityIssues(character, angle);
    if (angleIssues.length) return angleIssues;
    if (
      identityImage(character, angle) !== identityImage(previous, angle) ||
      character.angleReferences?.front?.image !==
        previous.angleReferences?.front?.image ||
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

export function generationReferenceManifest(
  input: GenerationRecipe,
): ReferenceAsset[] {
  return input.tweak
    ? [
        {
          id: input.tweak.sourceImage,
          label: "Original illustration to repair",
          role: "original",
        },
        ...referenceAssets(input),
      ]
    : referenceAssets(input);
}
