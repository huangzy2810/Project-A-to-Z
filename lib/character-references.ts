import type {
  BodyReference,
  CastLineup,
  Character,
  VisualStyle,
} from "./model";
function fingerprint(value: unknown): string {
  const text = JSON.stringify(value);
  let a = 2166136261,
    b = 3335557771;
  for (let i = 0; i < text.length; i++) {
    a = Math.imul(a ^ text.charCodeAt(i), 16777619);
    b = Math.imul(b ^ text.charCodeAt(i), 2246822519);
  }
  return `ref-v1:${(a >>> 0).toString(16)}${(b >>> 0).toString(16)}:${text.length}`;
}
export const emptyBody = (): BodyReference => ({
  build: "",
  proportions: "",
  referencePhotos: [],
});
export function bodySignature(
  character: Character,
  style: VisualStyle,
): string {
  return fingerprint([
    character.id,
    character.name,
    character.description,
    character.characterSheetImage,
    style.previewImage,
    style.description,
    style.referenceImages,
    character.body?.heightCm,
    character.body?.build,
    character.body?.proportions,
    character.body?.referencePhotos,
  ]);
}
export function bodyInputIssues(
  character: Character,
  style: VisualStyle,
): string[] {
  const issues: string[] = [];
  if (character.status !== "locked" || !character.characterSheetImage)
    issues.push(`Approve ${character.name}'s face sheet first.`);
  if (style.status !== "locked" || !style.previewImage)
    issues.push("Approve the visual style first.");
  const body = character.body;
  if (
    !body?.heightCm ||
    !Number.isFinite(body.heightCm) ||
    body.heightCm < 1 ||
    body.heightCm > 300
  )
    issues.push(
      `Enter ${character.name}'s approximate standing height (1–300 cm).`,
    );
  if (!body?.build.trim()) issues.push(`Describe ${character.name}'s build.`);
  return issues;
}
export function bodyApprovalIssues(
  character: Character,
  style: VisualStyle,
): string[] {
  const issues = bodyInputIssues(character, style);
  if (!character.body?.sheet?.image || character.body.sheet.status !== "locked")
    issues.push(`Generate and approve ${character.name}'s body sheet.`);
  if (
    character.body?.sheet &&
    character.body.sheet.signature !== bodySignature(character, style)
  )
    issues.push(
      `${character.name}'s body sheet is out of date. Regenerate it using the current face, height, build and style.`,
    );
  return issues;
}
export function lineupMembers(
  characters: Character[],
  style: VisualStyle,
): CastLineup["members"] {
  return characters.map((c) => ({
    id: c.id,
    name: c.name,
    heightCm: c.body?.heightCm || 0,
    signature: fingerprint([bodySignature(c, style), c.body?.sheet?.image]),
  }));
}
export function lineupSignature(
  members: CastLineup["members"],
  style: VisualStyle,
): string {
  return fingerprint([
    members,
    style.previewImage,
    style.description,
    style.referenceImages,
  ]);
}
export function lineupApprovalIssues(
  lineup: CastLineup | undefined,
  characters: Character[],
  style: VisualStyle,
): string[] {
  const issues = characters.flatMap((c) => bodyApprovalIssues(c, style));
  if (!lineup?.sheet?.image || lineup.sheet.status !== "locked")
    return [
      ...issues,
      "Generate and approve a relative-height lineup including the selected characters.",
    ];
  if (lineup.sheet.signature !== lineupSignature(lineup.members, style))
    issues.push(
      "The cast lineup uses an older visual style. Regenerate and approve it.",
    );
  for (const member of lineupMembers(characters, style)) {
    const saved = lineup.members.find((m) => m.id === member.id);
    if (
      !saved ||
      saved.signature !== member.signature ||
      saved.heightCm !== member.heightCm ||
      saved.name !== member.name
    )
      issues.push(
        `The cast lineup is missing or out of date for ${member.name}. Regenerate and approve the lineup.`,
      );
  }
  return [...new Set(issues)];
}
