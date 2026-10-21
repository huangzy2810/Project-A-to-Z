import type { GenerationRecipe } from "./model";
import {
  bodySignature,
  bodyInputIssues,
  bodyApprovalIssues,
  lineupApprovalIssues,
} from "./character-references";
export const MAX_REFERENCES = 16;
export interface ReferenceAsset {
  id: string;
  label: string;
  role: "identity" | "body" | "lineup" | "style" | "scene-layout" | "original";
}
export function prepareGenerationRecipe(
  input: GenerationRecipe,
): GenerationRecipe {
  // Reference approval needs signatures and IDs, not accumulated history or old prompts.
  input = {
    ...input,
    characters: input.characters.map((c) => ({
      ...c,
      generatedPrompt: undefined,
      faceHistory: undefined,
      body: c.body
        ? {
            ...c.body,
            history: undefined,
            sheet: c.body.sheet ? { ...c.body.sheet, prompt: "" } : undefined,
          }
        : undefined,
    })),
    castLineup: input.castLineup
      ? {
          ...input.castLineup,
          history: undefined,
          sheet: input.castLineup.sheet
            ? { ...input.castLineup.sheet, prompt: "" }
            : undefined,
        }
      : undefined,
    visualStyle: { ...input.visualStyle, generatedStylePrompt: "" },
  };
  if (input.kind === "character")
    return {
      ...input,
      characters: input.characters.map((c) => ({ ...c, body: undefined })),
      castLineup: undefined,
    };
  if (input.kind === "scene" || !input.kind)
    return { ...input, kind: "scene", references: [] };
  if (input.kind !== "style") return input;
  return {
    ...input,
    characters: [],
    castLineup: undefined,
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
    if (input.kind === "character") {
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
        c.characterSheetImage || c.primaryReferencePhoto,
        `${c.name}: approved identity reference`,
        "identity",
      );
      if (!c.characterSheetImage)
        c.referencePhotos.forEach((id, i) =>
          add(id, `${c.name}: identity photo ${i + 1}`, "identity"),
        );
    }
  }
  if (input.kind === "body") {
    for (const c of input.characters)
      c.body?.referencePhotos.forEach((id, i) =>
        add(
          id,
          `${c.name}: body proportion photo ${i + 1}; ignore clothing and face`,
          "body",
        ),
      );
  } else if (input.kind === "scene" || input.kind === "lineup") {
    for (const c of input.characters)
      if (c.body?.sheet?.status === "locked")
        add(
          c.body.sheet.image,
          `${c.name}: approved body proportions; not clothing`,
          "body",
        );
    if (
      input.kind === "scene" &&
      input.characters.length > 1 &&
      input.characters.some((c) => c.body) &&
      input.castLineup?.sheet?.status === "locked"
    )
      add(
        input.castLineup.sheet.image,
        "Approved cast lineup: relative height only; no extra cast",
        "lineup",
      );
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
  (input.kind === "body" || input.kind === "lineup"
    ? []
    : input.references
  ).forEach((id, i) =>
    add(
      id,
      input.kind === "character"
        ? `Character identity photo ${i + 1}`
        : input.kind === "style"
          ? `Visual style reference ${i + 1}`
          : `Scene reference ${i + 1} (background, placement and clothing only)`,
      input.kind === "character"
        ? "identity"
        : input.kind === "style"
          ? "style"
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
      : "Create one square children’s storybook illustration. Render artwork only; story text is added separately.",
    ...(input.tweak
      ? [
          `Requested local change: ${input.tweak.feedback}`,
          `Marked area: x ${Math.round(input.tweak.region.x * 100)}%, y ${Math.round(input.tweak.region.y * 100)}%, width ${Math.round(input.tweak.region.width * 100)}%, height ${Math.round(input.tweak.region.height * 100)}%. Preserve everything outside it.`,
        ]
      : []),
    input.kind === "character"
      ? "Create a canonical face-only identity sheet in a clean 2 × 2 grid. Show exactly four tightly cropped views of the same person: front, three-quarter, side profile, and front smiling. Keep facial identity, age, hair and skin tone identical across all four views. Show only face, natural hair and ears, cropped tightly below the chin, on a plain neutral background. No neck, shoulders, torso, full body, clothing, collars, hats, jewelry, accessories, props, scenery, additional people or labels. Extract facial identity from uploaded photos and ignore their clothing and surroundings. Facial identity takes precedence over any clothing or non-face details in the description."
      : input.kind === "style"
        ? "Create an uninhabited background-only sample of the requested illustration style. No people, characters, faces, silhouettes or animals, even if they appear in uploaded style references."
        : input.kind === "body" || input.kind === "lineup"
          ? "Create a character reference for approval in the approved illustration style."
          : "Illustrate this story scene with only the requested characters.",
    ...(input.kind === "body"
      ? [
          "Create a full-body proportions sheet with exactly three views of the same character: front, side and three-quarter, standing neutrally from head to toe. Use the approved face sheet exclusively for identity. Body photos guide only frame, shoulders, torso and limb proportions, never identity or outfits. Wear simple plain neutral gray short-sleeved top, trousers and flat shoes in every view, with no patterns, logos, jewelry or other accessories. Fully clothed, no anatomy detail, no scenery, no lettering. Written height/build/proportions take priority over photo perspective. These neutral clothes are calibration garments only, not a story outfit.",
        ]
      : []),
    ...(input.kind === "lineup"
      ? [
          "Create a full-body cast height lineup with exactly one of each supplied character, left to right in the listed order. All stand upright on the SAME ground baseline at the SAME camera distance in a front-facing orthographic view. Do not make everyone the same height. Scale their standing heights in the stated ratios; preserve the approved faces and body builds. Use plain neutral gray clothing and flat shoes. No perspective size tricks, no scenery, no text, no rulers, no repeated views and no extra people. The result is also a cast consistency test for approval.",
        ]
      : []),
    ...(input.kind === "body" ||
    input.kind === "lineup" ||
    input.kind === "scene"
      ? input.characters
          .filter((c) => c.body)
          .map(
            (c) =>
              `Body proportions for ${c.name}: standing height ${c.body?.heightCm} cm; build: ${c.body?.build}; proportions: ${c.body?.proportions || "follow approved body reference"}. Face identity always comes from the face sheet, never from body photos or neutral garments.`,
          )
      : []),
    ...(input.kind === "lineup"
      ? [
          `Left-to-right height order: ${input.characters.map((c) => `${c.name}: ${c.body?.heightCm} cm`).join("; ")}.`,
        ]
      : []),
    ...input.characters.map((c) =>
      c.status === "locked"
        ? `Preserve character identity: ${c.name}${input.kind === "scene" ? "" : `, ${c.description}`}. Keep facial features, hairstyle, approximate age and facial proportions consistent with their attached references.`
        : `Character: ${c.name}, ${c.description}.`,
    ),
    ...(input.kind === "scene"
      ? [
          "CHARACTER IDENTITY CONTRACT: The approved character sheets are the source of truth for identity. Draw each selected person once unless the scene explicitly requires otherwise. Keep each face, hair, skin tone, approximate age and distinctive facial features unchanged. Never exchange identities between characters or invent substitute faces. The multiple views on a reference sheet depict one person; never reproduce the sheet’s grid or extra views in a story illustration.",
          ...input.characters.map((c, index) => {
            const canonical =
              references.findIndex((r) => r.id === c.characterSheetImage) +
              1 +
              offset;
            return `Character ${index + 1}: ${c.name}. Canonical identity = Image ${canonical}. Use only the approved face's facial identity, hair and skin tone. Do not copy clothing, accessories, body poses or background elements from identity references.`;
          }),
          "Reference hierarchy: canonical face references govern facial identity only; clothing, outfits and accessories may come from scene photographs, while explicit written scene descriptions and required elements take priority; never copy clothing from character identity images; approved style governs medium, palette and texture only; scene photographs govern backgrounds, objects, camera framing, character placement and clothing only. Never borrow faces or people from style or scene references. Verify every selected character against their assigned sheet before completing the image.",
        ]
      : []),
    ...(input.kind === "scene"
      ? [
          ...input.characters
            .filter((c) => c.body?.sheet?.status === "locked")
            .map(
              (c) =>
                `BODY CONTRACT — ${c.name}: Image ${references.findIndex((r) => r.id === c.body?.sheet?.image) + 1 + offset} governs build and body proportions ONLY. Do not copy its neutral clothing, face, pose or layout. Use the written scene for outfits and actions.`,
            ),
          ...(input.characters.length > 1 &&
          input.characters.some((c) => c.body) &&
          input.castLineup?.sheet?.status === "locked"
            ? [
                `HEIGHT CONTRACT — Image ${references.findIndex((r) => r.id === input.castLineup?.sheet?.image) + 1 + offset} governs relative standing heights ONLY. Lineup left-to-right: ${input.castLineup.members.map((m) => `${m.name} (${m.heightCm} cm)`).join("; ")}. Render only selected characters, never extra lineup people. Preserve relative scale at equal depth; account for perspective and seated/standing poses. Faces come exclusively from each numbered canonical face sheet, outfits from scene text, and visual treatment from approved style.`,
              ]
            : []),
        ]
      : []),
    ...(input.kind === "body" || input.kind === "lineup"
      ? input.characters.map(
          (c) =>
            `Reference binding for ${c.name}: facial identity = Image ${references.findIndex((r) => r.id === c.characterSheetImage) + 1 + offset}${input.kind === "lineup" ? `; body proportions = Image ${references.findIndex((r) => r.id === c.body?.sheet?.image) + 1 + offset}` : ""}. Never swap identities between characters.`,
        )
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
    references.length
      ? "Use approved identity images exclusively for facial identity, hair, skin tone and age, and style images only for visual treatment. Use scene images for backgrounds, spatial placement and clothing, never photographed people’s likeness or physical features. Transfer garments and accessories onto the approved cast without copying the wearer’s identity. Render only selected approved characters. Explicit written outfits and actions take priority."
      : "No image references supplied; follow the descriptions.",
    `Exclude: text, lettering, watermarks, extra limbs, unintended duplicate characters, ${input.exclusions || "unrelated foreground objects"}.`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function generationApprovalIssues(input: GenerationRecipe): string[] {
  if (!["scene", "character", "body", "lineup"].includes(input.kind || ""))
    return [];
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
  if (input.kind === "body") {
    if (input.characters.length !== 1)
      issues.push("Choose exactly one character for a body sheet.");
    issues.push(
      ...input.characters.flatMap((c) => bodyInputIssues(c, input.visualStyle)),
    );
  }
  if (input.kind === "lineup") {
    if (input.characters.length < 2)
      issues.push("Select at least two characters for a height lineup.");
    issues.push(
      ...input.characters.flatMap((c) =>
        bodyApprovalIssues(c, input.visualStyle),
      ),
    );
  }
  if (input.kind === "scene" && input.characters.some((c) => c.body)) {
    issues.push(
      ...input.characters.flatMap((c) =>
        bodyApprovalIssues(c, input.visualStyle),
      ),
    );
    if (input.characters.length > 1)
      issues.push(
        ...lineupApprovalIssues(
          input.castLineup,
          input.characters,
          input.visualStyle,
        ),
      );
  }
  if (referenceAssets(input).length + (input.tweak ? 1 : 0) > MAX_REFERENCES)
    issues.push(
      `Use no more than ${MAX_REFERENCES} image references. Reduce the selected cast or extra style photos.`,
    );
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
      character.description !== previous.description ||
      bodySignature(character, recipe.visualStyle) !==
        bodySignature(previous, recipe.visualStyle) ||
      character.body?.sheet?.image !== previous.body?.sheet?.image ||
      character.body?.sheet?.status !== previous.body?.sheet?.status
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
