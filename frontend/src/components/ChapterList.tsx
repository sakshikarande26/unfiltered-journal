import type { EntrySummary } from "../../../shared/types.js";
import { ChapterCard } from "./ChapterCard.js";

export function ChapterList({ entries }: { entries: EntrySummary[] }) {
  return (
    <div className="chapter-list">
      {entries.map((entry) => (
        <ChapterCard key={entry.weekId} entry={entry} />
      ))}
    </div>
  );
}
