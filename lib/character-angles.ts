import type {
  AngleReference,
  BookProject,
  Character,
  FaceAngle,
  GenerationRecipe,
} from "./model";
export const FACE_ANGLES: FaceAngle[] = [
  "front",
  "three-quarter",
  "left-profile",
  "right-profile",
];
export const ANGLE_LABELS: Record<FaceAngle, string> = {
  front: "Front",
  "three-quarter": "Three-quarter",
  "left-profile": "Left profile",
  "right-profile": "Right profile",
};
export function angleReference(
  character: Character,
  angle: FaceAngle,
): AngleReference {
  return (
    character.angleReferences?.[angle] || {
      referencePhotos: angle === "front" ? character.referencePhotos : [],
      primaryReferencePhoto:
        angle === "front" ? character.primaryReferencePhoto : undefined,
      status: "draft",
    }
  );
}
export function angleApproved(character: Character, angle: FaceAngle): boolean {
  const ref = character.angleReferences?.[angle];
  const front = character.angleReferences?.front;
  return !!(
    front?.image &&
    front.status === "locked" &&
    ref?.image &&
    ref.status === "locked" &&
    (angle === "front" || ref.frontReference === front.image)
  );
}
export function withAngle(
  character: Character,
  angle: FaceAngle,
  patch: Partial<AngleReference>,
): Character {
  const reference = { ...angleReference(character, angle), ...patch };
  return {
    ...character,
    angleReferences: { ...character.angleReferences, [angle]: reference },
    ...(angle === "front"
      ? {
          referencePhotos: reference.referencePhotos,
          primaryReferencePhoto: reference.primaryReferencePhoto,
          characterSheetImage: reference.image || character.characterSheetImage,
          status: reference.status,
          styleReference: reference.styleReference,
          generationModel: reference.generationModel,
        }
      : {}),
  };
}
export function identityImage(
  character: Character,
  angle?: FaceAngle,
): string | undefined {
  return character.angleReferences
    ? character.angleReferences[angle || "front"]?.image
    : character.characterSheetImage;
}
export function angleIdentityIssues(
  character: Character,
  angle: FaceAngle = "front",
): string[] {
  if (!character.angleReferences)
    return angle === "front"
      ? []
      : [
          `Set up angle references for ${character.name} and approve their ${ANGLE_LABELS[angle]} portrait before using that facing direction.`,
        ];
  if (!angleApproved(character, "front"))
    return [
      `Approve ${character.name}'s Front portrait in Character Studio first.`,
    ];
  return angleApproved(character, angle)
    ? []
    : [
        `Generate and approve ${character.name}'s ${ANGLE_LABELS[angle]} portrait against their current Front portrait before using it on this page.`,
      ];
}
export function angleRecipe(
  project: BookProject,
  character: Character,
  angle: FaceAngle,
): GenerationRecipe {
  const source = angleReference(character, angle);
  if (angle === "front" && !source.referencePhotos.length)
    throw new Error(
      "Upload a clear front-facing photo before generating the Front portrait.",
    );
  if (angle !== "front" && !angleApproved(character, "front"))
    throw new Error(
      "Approve the Front portrait before generating other angles.",
    );
  return {
    kind: "character",
    characterAngle: angle,
    characters: [{ ...character, status: "locked" }],
    visualStyle: project.visualStyle,
    scene: `${character.name}: ${character.description}. Generate only this person's ${ANGLE_LABELS[angle]} face portrait. ${!source.referencePhotos.length ? "No photo for this angle was supplied. Infer this view from the approved front portrait; the user must review the result for accuracy." : "Use the uploaded photos assigned to this angle for its geometry."}`,
    references: [],
    composition:
      "One large tightly cropped face, natural hair and ears on a plain neutral background. Crop just below the chin. No grid or additional views.",
    requiredElements: `Exactly one ${ANGLE_LABELS[angle]} portrait of ${character.name}`,
    exclusions:
      "neck, shoulders, body, clothing, accessories, props, scenery, text, grids, duplicate faces",
  };
}
