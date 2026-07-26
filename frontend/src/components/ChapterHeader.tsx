import type { EntryDetail } from "../../../shared/types.js";

export function ChapterHeader({ entry }: { entry: EntryDetail }) {
  return (
    <header>
      <h1 className="identity-block__name">{entry.title}</h1>
      <p className="identity-block__bio">{entry.description}</p>
    </header>
  );
}
