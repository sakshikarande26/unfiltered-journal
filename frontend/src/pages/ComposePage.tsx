import { useCallback, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { DraftView, EntryDetail, GoalsOwnerView, WeekId } from "../../../shared/types.js";
import {
  ApiError,
  deletePhoto,
  getDraft,
  getGoals,
  publishDraft,
  saveDraft,
  saveGoals,
  uploadPhoto,
} from "../api/client.js";
import { useFetch } from "../hooks/useFetch.js";

const MAX_PHOTOS = 5;
const MAX_GOALS = 5;

/**
 * The weekly composer. Everything here is a local write - no network beyond
 * this device is required, and the sync engine pushes in the background.
 * Text stays editable until the week locks; goals freeze at publish.
 */
export function ComposePage() {
  const [version, setVersion] = useState(0);
  const load = useCallback(async () => {
    const draft = await getDraft();
    let goals: GoalsOwnerView | null = null;
    if (draft.entry) {
      try {
        goals = await getGoals(draft.weekId);
      } catch {
        goals = null;
      }
    }
    return { draft, goals };
  }, [version]);
  const { loading, data, error } = useFetch(load, [version]);
  const refresh = () => setVersion((v) => v + 1);

  if (loading) return null;
  if (error) return <p className="compose">Couldn&apos;t load the draft: {error.message}</p>;
  if (!data) return null;

  const { draft, goals } = data;
  const locked = draft.state === "locked";

  return (
    <div className="compose">
      <header className="compose__header">
        <h1>This week — {draft.weekId}</h1>
        <StateBadge state={draft.state} publishedAt={draft.entry?.publishedAt ?? null} />
      </header>
      {locked ? (
        <p className="compose__notice">
          This week is locked. <Link to={`/chapters/${draft.weekId}`}>View the entry →</Link>
        </p>
      ) : (
        <Composer draft={draft} goals={goals} onChanged={refresh} />
      )}
    </div>
  );
}

function StateBadge({ state, publishedAt }: { state: string; publishedAt: string | null }) {
  const label =
    state === "empty" ? "empty" : publishedAt ? "published" : "draft";
  return <span className={`state-badge state-badge--${label}`}>{label}</span>;
}

function Composer({
  draft,
  goals,
  onChanged,
}: {
  draft: DraftView;
  goals: GoalsOwnerView | null;
  onChanged: () => void;
}) {
  const weekId = draft.weekId;
  const entry = draft.entry;
  const published = entry?.publishedAt != null;
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<unknown>) => {
    setErr(null);
    setBusy(true);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {err && <p className="compose__error">{err}</p>}
      <TextSection
        entry={entry}
        busy={busy}
        onSave={(patch) => run(() => saveDraft(weekId, patch))}
      />
      <PhotosSection
        entry={entry}
        busy={busy}
        onUpload={(file) => run(() => uploadPhoto(weekId, file))}
        onDelete={(pos) => run(() => deletePhoto(weekId, pos))}
      />
      <GoalsSection
        goals={goals}
        writable={draft.goalsWritable && entry != null}
        busy={busy}
        onSave={(gs) => run(() => saveGoals(weekId, gs))}
      />
      <section className="compose__publish">
        <button
          className="btn btn--primary"
          disabled={busy || published || entry == null}
          onClick={() => run(() => publishDraft(weekId))}
        >
          {published ? "Published" : "Publish this week"}
        </button>
        <p className="compose__hint">
          Publishing freezes your goals. Text stays editable until the week
          locks Sunday night — after that it&apos;s permanent.
        </p>
      </section>
    </>
  );
}

function TextSection({
  entry,
  busy,
  onSave,
}: {
  entry: EntryDetail | null;
  busy: boolean;
  onSave: (patch: { title: string; description: string; liked: string; challenging: string }) => void;
}) {
  const [title, setTitle] = useState(entry?.title ?? "");
  const [description, setDescription] = useState(entry?.description ?? "");
  const [liked, setLiked] = useState(entry?.liked ?? "");
  const [challenging, setChallenging] = useState(entry?.challenging ?? "");

  return (
    <section className="compose__section">
      <h2>The week</h2>
      <input
        className="compose__input"
        placeholder="Title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <textarea
        className="compose__input"
        placeholder="Description"
        rows={2}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <textarea
        className="compose__input"
        placeholder="One thing you liked"
        rows={2}
        value={liked}
        onChange={(e) => setLiked(e.target.value)}
      />
      <textarea
        className="compose__input"
        placeholder="One thing you found challenging"
        rows={2}
        value={challenging}
        onChange={(e) => setChallenging(e.target.value)}
      />
      <button
        className="btn"
        disabled={busy}
        onClick={() => onSave({ title, description, liked, challenging })}
      >
        Save
      </button>
    </section>
  );
}

function PhotosSection({
  entry,
  busy,
  onUpload,
  onDelete,
}: {
  entry: EntryDetail | null;
  busy: boolean;
  onUpload: (file: File) => void;
  onDelete: (position: number) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const photos = entry?.photos ?? [];
  return (
    <section className="compose__section">
      <h2>Photos ({photos.length}/{MAX_PHOTOS})</h2>
      <div className="compose__photos">
        {photos.map((p) => (
          <figure key={p.position} className="compose__photo">
            <img src={p.thumbUrl} alt={p.aiDescription ?? `photo ${p.position + 1}`} />
            <button
              className="compose__photo-remove"
              type="button"
              disabled={busy}
              onClick={() => onDelete(p.position)}
              aria-label={`Remove photo ${p.position + 1}`}
            >
              ×
            </button>
          </figure>
        ))}
        {entry && photos.length < MAX_PHOTOS && (
          <button
            className="compose__photo-add"
            type="button"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            + Add photo
          </button>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onUpload(f);
          e.target.value = "";
        }}
      />
      {!entry && <p className="compose__hint">Save the text above first — that creates this week&apos;s entry.</p>}
    </section>
  );
}

function GoalsSection({
  goals,
  writable,
  busy,
  onSave,
}: {
  goals: GoalsOwnerView | null;
  writable: boolean;
  busy: boolean;
  onSave: (goals: { text: string }[]) => void;
}) {
  const [items, setItems] = useState<string[]>(
    goals ? goals.goals.map((g) => g.text) : [""],
  );
  const update = (i: number, v: string) =>
    setItems((prev) => prev.map((t, j) => (j === i ? v : t)));

  return (
    <section className="compose__section">
      <h2>Goals ({items.filter((t) => t.trim()).length}/{MAX_GOALS})</h2>
      <p className="compose__hint">
        Private — never shown outside this entry. Frozen the moment you publish.
      </p>
      {items.map((text, i) => (
        <div key={i} className="compose__goal-row">
          <input
            className="compose__input"
            placeholder={`Goal ${i + 1}`}
            value={text}
            disabled={!writable || busy}
            onChange={(e) => update(i, e.target.value)}
          />
          {writable && (
            <button
              className="compose__photo-remove compose__goal-remove"
              type="button"
              disabled={busy}
              onClick={() => setItems((prev) => prev.filter((_, j) => j !== i))}
              aria-label={`Remove goal ${i + 1}`}
            >
              ×
            </button>
          )}
        </div>
      ))}
      {writable && items.length < MAX_GOALS && (
        <button className="btn" type="button" disabled={busy} onClick={() => setItems((p) => [...p, ""])}>
          + Add goal
        </button>
      )}
      {writable && (
        <button
          className="btn"
          disabled={busy}
          onClick={() => onSave(items.filter((t) => t.trim()).map((text) => ({ text })))}
        >
          Save goals
        </button>
      )}
    </section>
  );
}
