import { Link } from "react-router-dom";
import type { EntrySummary } from "../../../shared/types.js";
import { PhotoStack } from "./PhotoStack.js";

export function ChapterCard({ entry }: { entry: EntrySummary }) {
  return (
    <Link className="chapter-card" to={`/chapters/${entry.weekId}`}>
      <PhotoStack photos={entry.photos} />
      <h2 className="chapter-card__title">{entry.title}</h2>
      <p className="chapter-card__description">{entry.description}</p>
    </Link>
  );
}
