import type { EntryDetail } from "../../../shared/types.js";

export function ChapterProse({ entry }: { entry: EntryDetail }) {
  return (
    <div className="chapter-prose">
      {entry.liked && (
        <section>
          <h3 className="chapter-prose__label">Liked</h3>
          <p className="chapter-prose__body">{entry.liked}</p>
        </section>
      )}
      {entry.challenging && (
        <section>
          <h3 className="chapter-prose__label">Challenging</h3>
          <p className="chapter-prose__body">{entry.challenging}</p>
        </section>
      )}
    </div>
  );
}
