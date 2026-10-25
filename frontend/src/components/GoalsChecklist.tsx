import { useCallback, useState } from "react";
import type { GoalsOwnerView, WeekId } from "../../../shared/types.js";
import { completeGoal, getGoals, uncompleteGoal } from "../api/client.js";
import { useFetch } from "../hooks/useFetch.js";

/**
 * The owner's private goal list on a chapter: text is only ever fetched from
 * the owner route, and completion is the one post-lock write — toggling works
 * on any entry, however old.
 */
export function GoalsChecklist({ weekId }: { weekId: WeekId }) {
  const [version, setVersion] = useState(0);
  const load = useCallback(() => getGoals(weekId), [weekId, version]);
  const { loading, data: view, error } = useFetch(load, [weekId, version]);
  const [busy, setBusy] = useState<string | null>(null);

  if (loading) return null;
  if (error) return null; // no entry or no goals — nothing to render
  if (!view || view.goals.length === 0) return null;

  const toggle = async (g: GoalsOwnerView["goals"][number]) => {
    setBusy(g.id);
    try {
      if (g.completedAt) await uncompleteGoal(weekId, g.id);
      else await completeGoal(weekId, g.id);
      setVersion((v) => v + 1);
    } finally {
      setBusy(null);
    }
  };

  const done = view.goals.filter((g) => g.completedAt).length;
  return (
    <section className="goals-checklist">
      <h2 className="goals-checklist__title">
        Goals <span className="goals-checklist__count">{done}/{view.goals.length}</span>
      </h2>
      <ul className="goals-checklist__list">
        {view.goals.map((g) => (
          <li key={g.id}>
            <label className={`goals-checklist__item${g.completedAt ? " is-done" : ""}`}>
              <input
                type="checkbox"
                checked={g.completedAt !== null}
                disabled={busy === g.id}
                onChange={() => toggle(g)}
              />
              <span>{g.text}</span>
            </label>
          </li>
        ))}
      </ul>
    </section>
  );
}
