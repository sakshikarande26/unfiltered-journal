import { useCallback } from "react";
import { Link, useParams } from "react-router-dom";
import type { WeekId } from "../../../shared/types.js";
import { getEntry } from "../api/client.js";
import { useFetch } from "../hooks/useFetch.js";
import { ChapterHeader } from "../components/ChapterHeader.js";
import { PhotoGallery } from "../components/PhotoGallery.js";
import { ChapterProse } from "../components/ChapterProse.js";
import { GoalsSummary } from "../components/GoalsSummary.js";
import { GoalsChecklist } from "../components/GoalsChecklist.js";

export function ChapterView() {
  const { weekId } = useParams<{ weekId: string }>();
  const load = useCallback(() => getEntry(weekId as WeekId), [weekId]);
  const { loading, data: entry, error } = useFetch(load, [weekId]);

  return (
    <div className="chapter-view">
      <Link className="chapter-view__back" to="/">
        &larr; Back
      </Link>
      {loading && null}
      {error && <p>Couldn't load this chapter: {error.message}</p>}
      {entry && (
        <>
          <ChapterHeader entry={entry} />
          <PhotoGallery photos={entry.photos} />
          <ChapterProse entry={entry} />
          <GoalsChecklist weekId={weekId as WeekId} />
          <GoalsSummary goals={entry.goals} />
        </>
      )}
    </div>
  );
}
