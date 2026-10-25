import type { Character } from "@/lib/model";

export function CharacterChoices({
  characters,
  selectedIds,
  onChange,
}: {
  characters: Character[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  return (
    <>
      <span className="field-label">Who appears in this scene?</span>
      <div
        className="character-choices"
        role="group"
        aria-label="Who appears in this scene?"
      >
        {characters.map((c) => (
          <label key={c.id}>
            <input
              type="checkbox"
              checked={selectedIds.includes(c.id)}
              onChange={(e) =>
                onChange(
                  e.target.checked
                    ? [...selectedIds, c.id]
                    : selectedIds.filter((id) => id !== c.id),
                )
              }
            />
            {c.name}
            {c.status === "locked" ? " ✓" : ""}
          </label>
        ))}
      </div>
    </>
  );
}
