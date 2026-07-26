import type { GoalDisclosure } from "../../../shared/types.js";

// Deliberately renders only done/total + ticked positions - never goal text,
// never a count of what's unfinished. See shared/types.ts GoalDisclosure.
export function GoalsSummary({ goals }: { goals: GoalDisclosure }) {
  if (goals.total === 0) return null;

  return (
    <p className="goals-summary">
      Goals {goals.done}/{goals.total}
      {goals.completedPositions.length > 0 && (
        <> — {goals.completedPositions.map(() => "✓").join(" ")}</>
      )}
    </p>
  );
}
