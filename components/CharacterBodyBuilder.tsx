"use client";
import { useState } from "react";
import type {
  BodyReference,
  BookProject,
  CastLineup,
  Character,
} from "@/lib/model";
import {
  bodyApprovalIssues,
  bodyInputIssues,
  bodySignature,
  emptyBody,
  lineupApprovalIssues,
} from "@/lib/character-references";
import { generationApprovalIssues } from "@/lib/recipe";
import { AssetImage } from "./BookPage";
import DropZone from "./DropZone";
export default function CharacterBodyBuilder({
  project,
  character,
  disabled,
  onBody,
  onGenerateBody,
  onLineup,
  onGenerateLineup,
}: {
  project: BookProject;
  character: Character;
  disabled: boolean;
  onBody: (id: string, body: BodyReference) => void;
  onGenerateBody: (id: string) => void;
  onLineup: (lineup: CastLineup) => void;
  onGenerateLineup: (ids: string[]) => void;
}) {
  const body = character.body || emptyBody();
  const sheet = body.sheet;
  const locked = sheet?.status === "locked";
  const patch = (values: Partial<BodyReference>) =>
    onBody(character.id, { ...body, ...values });
  const [selectedIds, setSelectedIds] = useState(
    project.castLineup?.members.map((m) => m.id) ||
      project.characters.map((c) => c.id),
  );
  const cast = project.characters.filter((c) => selectedIds.includes(c.id));
  const lineup = project.castLineup;
  const lineupLocked = lineup?.sheet?.status === "locked";
  const inputIssues = generationApprovalIssues({
    kind: "lineup",
    characters: cast,
    visualStyle: project.visualStyle,
    scene: "Cast height lineup",
    references: [],
    composition: "",
    exclusions: "",
  });
  const lineupIssues = lineupApprovalIssues(lineup, cast, project.visualStyle);
  const sameSelection =
    JSON.stringify(lineup?.members.map((m) => m.id)) ===
    JSON.stringify(cast.map((c) => c.id));
  return (
    <>
      <section className="body-reference" aria-label="Body reference builder">
        <h3>Body proportions</h3>
        <p>
          Keep face photos above and optional full-body photos here. Once you
          add body details, approve a body sheet before using this character in
          chapters. Body references govern height, build and proportions, never
          story clothing.
        </p>
        <fieldset disabled={disabled || locked}>
          <label className="field">
            <span>Approximate standing height (cm)</span>
            <input
              type="number"
              min="1"
              max="300"
              step="1"
              value={body.heightCm ?? ""}
              onChange={(e) =>
                patch({
                  heightCm: e.target.value ? Number(e.target.value) : undefined,
                })
              }
            />
          </label>
          <label className="field">
            <span>Build / frame</span>
            <input
              maxLength={1000}
              value={body.build}
              placeholder="For example: small frame, narrow shoulders"
              onChange={(e) => patch({ build: e.target.value })}
            />
          </label>
          <label className="field">
            <span>Body proportions and posture</span>
            <textarea
              maxLength={1000}
              value={body.proportions}
              placeholder="For example: short legs relative to torso, relaxed upright posture"
              onChange={(e) => patch({ proportions: e.target.value })}
            />
          </label>
          <p className="help">
            Full-body photos are optional. They guide proportions only; their
            outfits and faces are ignored. The generated sheet uses plain
            neutral gray clothing.
          </p>
          <DropZone
            label={`${character.name} body reference photos`}
            images={body.referencePhotos}
            disabled={disabled || locked}
            onChange={(ids) => patch({ referencePhotos: ids })}
          />
        </fieldset>
        {character.body && (
          <p className="help">
            {bodyApprovalIssues(character, project.visualStyle).join(" ") ||
              "Body proportions approved and current."}
          </p>
        )}
        <button
          disabled={
            disabled ||
            locked ||
            bodyInputIssues(character, project.visualStyle).length > 0
          }
          onClick={() => onGenerateBody(character.id)}
        >
          {sheet ? "Regenerate body sheet" : "Generate body sheet"}
        </button>
        <button
          disabled={
            disabled ||
            !sheet ||
            (!locked &&
              (bodyInputIssues(character, project.visualStyle).length > 0 ||
                sheet.signature !==
                  bodySignature(character, project.visualStyle)))
          }
          onClick={() =>
            sheet &&
            patch({ sheet: { ...sheet, status: locked ? "draft" : "locked" } })
          }
        >
          {locked ? "Unlock body sheet" : "Approve body sheet"}
        </button>
        {sheet && (
          <AssetImage
            id={sheet.image}
            alt={`${character.name} body sheet`}
            className="body-sheet-preview"
          />
        )}
        {!!body.history?.length && (
          <details>
            <summary>Previous body sheets</summary>
            <div className="reference-history">
              {body.history.map((old) => (
                <button
                  key={old.image}
                  disabled={disabled || locked}
                  onClick={() => patch({ sheet: { ...old, status: "draft" } })}
                >
                  <AssetImage id={old.image} alt="Previous body reference" />
                  Select body sheet
                </button>
              ))}
            </div>
          </details>
        )}
      </section>
      <details className="body-reference">
        <summary>Relative-height cast lineup</summary>
        <p>
          Select at least two characters. Approve each face and body first.
          Adjust approximate heights using the controls below, then generate and
          approve a lineup. Changing a height requires unlocking and
          regenerating that body sheet first.
        </p>
        <div className="character-choices">
          {project.characters.map((c) => (
            <label key={c.id}>
              <input
                type="checkbox"
                disabled={disabled || lineupLocked}
                checked={selectedIds.includes(c.id)}
                onChange={(e) =>
                  setSelectedIds(
                    e.target.checked
                      ? [...selectedIds, c.id]
                      : selectedIds.filter((id) => id !== c.id),
                  )
                }
              />
              {c.name}
            </label>
          ))}
        </div>
        <div
          className="height-preview"
          aria-label="Schematic relative-height preview"
        >
          {cast.map((c) => (
            <div key={c.id}>
              <div className="height-column">
                <svg
                  role="img"
                  aria-label={`${c.name}: ${c.body?.heightCm || 0} cm`}
                  viewBox="0 0 80 200"
                  style={{
                    height: `${200 * ((c.body?.heightCm || 0) / Math.max(1, ...cast.map((p) => p.body?.heightCm || 0)))}px`,
                  }}
                >
                  <circle cx="40" cy="22" r="18" />
                  <path d="M25 44H55L67 115H52V195H43V125H37V195H28V115H13Z" />
                </svg>
              </div>
              <strong>{c.name}</strong>
              <span>{c.body?.heightCm || "—"} cm</span>
              <label>
                <span className="sr-only">{c.name} lineup height</span>
                <input
                  aria-label={`${c.name} lineup height`}
                  type="range"
                  min="1"
                  max="300"
                  step="1"
                  value={c.body?.heightCm || 100}
                  disabled={
                    disabled ||
                    lineupLocked ||
                    c.body?.sheet?.status === "locked"
                  }
                  onChange={(e) =>
                    onBody(c.id, {
                      ...(c.body || emptyBody()),
                      heightCm: Number(e.target.value),
                    })
                  }
                />
              </label>
            </div>
          ))}
        </div>
        <p className="help">
          This silhouette preview shows height ratios, not likeness. The
          generated lineup below is the cast consistency test. Inspect faces,
          builds, and the common ground baseline before approval.
        </p>
        {!!inputIssues.length && (
          <p className="help">{[...new Set(inputIssues)].join(" ")}</p>
        )}
        {lineup?.sheet && (
          <p className="help">
            {lineupIssues.join(" ") ||
              (sameSelection
                ? "Cast lineup is current."
                : "The cast selection changed. Generate a new lineup.")}
          </p>
        )}
        <button
          disabled={disabled || lineupLocked || inputIssues.length > 0}
          onClick={() => onGenerateLineup(cast.map((c) => c.id))}
        >
          Generate cast lineup
        </button>
        <button
          disabled={
            disabled ||
            !lineup?.sheet ||
            (!lineupLocked &&
              (!sameSelection ||
                lineupApprovalIssues(
                  { ...lineup, sheet: { ...lineup.sheet, status: "locked" } },
                  cast,
                  project.visualStyle,
                ).length > 0))
          }
          onClick={() =>
            lineup?.sheet &&
            onLineup({
              ...lineup,
              sheet: {
                ...lineup.sheet,
                status: lineupLocked ? "draft" : "locked",
              },
            })
          }
        >
          {lineupLocked ? "Unlock cast lineup" : "Approve cast lineup"}
        </button>
        {lineup?.sheet && (
          <AssetImage
            id={lineup.sheet.image}
            alt="Generated relative-height cast lineup"
            className="body-sheet-preview"
          />
        )}
        {!!lineup?.history?.length && (
          <details>
            <summary>Previous cast lineups</summary>
            <div className="reference-history">
              {lineup.history.map((old) => (
                <button
                  key={old.image}
                  disabled={disabled || lineupLocked}
                  onClick={() =>
                    onLineup({ ...lineup, sheet: { ...old, status: "draft" } })
                  }
                >
                  <AssetImage id={old.image} alt="Previous cast lineup" />
                  Select lineup
                </button>
              ))}
            </div>
            <p className="help">
              Only a lineup matching the current cast and approvals can be
              approved.
            </p>
          </details>
        )}
      </details>
    </>
  );
}
