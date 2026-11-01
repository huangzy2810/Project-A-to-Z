"use client";
import type { Character, FaceAngle } from "@/lib/model";
import {
  ANGLE_LABELS,
  FACE_ANGLES,
  angleApproved,
  angleReference,
  withAngle,
} from "@/lib/character-angles";
import DropZone from "./DropZone";
import { AssetImage } from "./BookPage";
export function CharacterAngleStudio({
  character,
  angle,
  onAngle,
  disabled,
  generating,
  onChange,
  onGenerate,
}: {
  character: Character;
  angle: FaceAngle;
  onAngle: (angle: FaceAngle) => void;
  disabled: boolean;
  generating: boolean;
  onChange: (character: Character) => void;
  onGenerate: (angle: FaceAngle) => void;
}) {
  const ref = angleReference(character, angle);
  const approved = angleApproved(character, angle);
  const frontReady = angleApproved(character, "front");
  const sourcePhoto = ref.primaryReferencePhoto || ref.referencePhotos[0];
  const comparisonSource =
    sourcePhoto ||
    (angle !== "front" ? character.angleReferences?.front?.image : undefined);
  return (
    <section aria-label="Angle references">
      <div className="tabs" role="group" aria-label="Portrait angle">
        {FACE_ANGLES.map((value) => (
          <button
            key={value}
            disabled={disabled}
            className={angle === value ? "selected" : ""}
            onClick={() => onAngle(value)}
          >
            {ANGLE_LABELS[value]}
            {angleApproved(character, value) ? " ✓" : ""}
          </button>
        ))}
      </div>
      <p>
        Left/right means the direction the nose points in the image. Upload
        clear, well-lit face photos without filters or obstructions. Generate
        and approve Front first; each other angle uses that approved identity.
      </p>
      <p role="status">
        {ANGLE_LABELS[angle]} ·{" "}
        {approved
          ? "Approved"
          : ref.image
            ? "Awaiting approval"
            : "Not generated"}
      </p>
      {angle !== "front" && !frontReady && (
        <p className="help">
          Approve the Front portrait before generating other angles.
        </p>
      )}
      {angle !== "front" && !ref.referencePhotos.length && (
        <p className="help">
          A real photo of this angle should improve accuracy. You can generate
          from the approved Front portrait, then review carefully before
          approval.
        </p>
      )}
      {angle !== "front" &&
        ref.image &&
        ref.frontReference !== character.angleReferences?.front?.image && (
          <p className="help">
            The Front identity has changed. Review and approve this angle again
            or regenerate it.
          </p>
        )}
      <fieldset disabled={disabled || approved || !character.id}>
        <DropZone
          label="Reference photos"
          images={ref.referencePhotos}
          primary={ref.primaryReferencePhoto}
          onPrimary={(id) =>
            onChange(withAngle(character, angle, { primaryReferencePhoto: id }))
          }
          onChange={(ids) =>
            onChange(
              withAngle(character, angle, {
                referencePhotos: ids,
                primaryReferencePhoto: ids.includes(
                  ref.primaryReferencePhoto || "",
                )
                  ? ref.primaryReferencePhoto
                  : ids[0],
              }),
            )
          }
          disabled={disabled || approved || !character.id}
        />
        {ref.referencePhotos.map((id, i) => (
          <label key={id}>
            Photo {i + 1} angle
            <select
              aria-label={`Photo ${i + 1} angle`}
              value={angle}
              onChange={(e) => {
                const target = e.target.value as FaceAngle;
                const targetRef = angleReference(character, target);
                let updated = withAngle(character, angle, {
                  referencePhotos: ref.referencePhotos.filter(
                    (photo) => photo !== id,
                  ),
                  primaryReferencePhoto:
                    ref.primaryReferencePhoto === id
                      ? ref.referencePhotos.find((photo) => photo !== id)
                      : ref.primaryReferencePhoto,
                });
                updated = withAngle(updated, target, {
                  referencePhotos: [
                    ...new Set([...targetRef.referencePhotos, id]),
                  ],
                  primaryReferencePhoto: targetRef.primaryReferencePhoto || id,
                });
                onChange(updated);
              }}
            >
              {FACE_ANGLES.map((value) => (
                <option
                  key={value}
                  value={value}
                  disabled={value !== angle && angleApproved(character, value)}
                >
                  {ANGLE_LABELS[value]}
                </option>
              ))}
            </select>
          </label>
        ))}
      </fieldset>
      <div className="angle-comparison">
        <figure>
          <figcaption>
            {sourcePhoto
              ? `${ANGLE_LABELS[angle]} source photo`
              : "Approved Front identity anchor"}
          </figcaption>
          {comparisonSource ? (
            <AssetImage
              id={comparisonSource}
              alt={
                sourcePhoto
                  ? `${ANGLE_LABELS[angle]} source photo`
                  : "Approved Front identity anchor"
              }
            />
          ) : (
            <p>No photo assigned.</p>
          )}
        </figure>
        <figure>
          <figcaption>{ANGLE_LABELS[angle]} illustrated portrait</figcaption>
          {ref.image ? (
            <AssetImage
              id={ref.image}
              alt={`${ANGLE_LABELS[angle]} illustrated portrait`}
            />
          ) : (
            <p>Your portrait will appear here.</p>
          )}
        </figure>
      </div>
      <div className="actions">
        <button
          className="primary"
          disabled={
            disabled ||
            approved ||
            !character.name.trim() ||
            (angle === "front" ? !ref.referencePhotos.length : !frontReady)
          }
          onClick={() => onGenerate(angle)}
        >
          {generating
            ? "Drawing…"
            : angle !== "front" && !ref.referencePhotos.length
              ? "Generate from approved front reference"
              : ref.image
                ? "Try Again"
                : angle === "front"
                  ? "Generate Character"
                  : `Generate ${ANGLE_LABELS[angle]} portrait`}
        </button>
        <button
          disabled={
            disabled ||
            !ref.image ||
            !character.id ||
            (angle !== "front" && !frontReady)
          }
          onClick={() =>
            onChange(
              withAngle(character, angle, {
                status: approved ? "draft" : "locked",
                ...(angle !== "front" && !approved
                  ? { frontReference: character.angleReferences?.front?.image }
                  : {}),
              }),
            )
          }
        >
          {angle === "front"
            ? approved
              ? "Unlock Character"
              : "Lock Character"
            : approved
              ? `Unlock ${ANGLE_LABELS[angle]}`
              : `Approve ${ANGLE_LABELS[angle]}`}
        </button>
      </div>
      <p className="help">
        {angle === "front"
          ? "Lock Character approves the Front portrait. This becomes the identity anchor for the other angles."
          : "Approval is separate for this angle. Review likeness against the source photo and approved Front portrait."}{" "}
        Sample artwork is a workflow preview and does not reproduce likeness or
        pose.
      </p>
      {character.legacySheetImage && (
        <details>
          <summary>View previous character sheet</summary>
          <AssetImage
            id={character.legacySheetImage}
            alt="Previous character sheet"
          />
        </details>
      )}
    </section>
  );
}
