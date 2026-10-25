import { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import { getYear } from "../api/client.js";
import { useFetch } from "../hooks/useFetch.js";

const CURRENT_YEAR = new Date().getFullYear();

/**
 * The private year grid: every ISO week of the year as a cell — filled (with
 * the cover photo), missed (permanent gap), current, or upcoming.
 */
export function YearPage() {
  const [year, setYear] = useState(CURRENT_YEAR);
  const load = useCallback(() => getYear(year), [year]);
  const { loading, data, error } = useFetch(load, [year]);

  return (
    <div className="year-page">
      <header className="year-page__header">
        <button className="btn" onClick={() => setYear((y) => y - 1)}>← {year - 1}</button>
        <h1>{year}</h1>
        <button
          className="btn"
          disabled={year >= CURRENT_YEAR}
          onClick={() => setYear((y) => y + 1)}
        >
          {year + 1} →
        </button>
      </header>
      <div className="year-page__legend">
        <span><i className="cell cell--filled" /> filled</span>
        <span><i className="cell cell--missed" /> missed</span>
        <span><i className="cell cell--current" /> this week</span>
        <span><i className="cell cell--upcoming" /> upcoming</span>
      </div>
      {loading && null}
      {error && <p>Couldn&apos;t load the year: {error.message}</p>}
      {data && (
        <div className="year-grid">
          {data.weeks.map((w) =>
            w.state === "filled" || w.state === "current" ? (
              <Link
                key={w.weekId}
                to={w.state === "filled" ? `/chapters/${w.weekId}` : "/compose"}
                className={`year-grid__cell cell cell--${w.state}`}
                title={`${w.weekId} — ${w.state}`}
              >
                {w.coverUrl && <img src={w.coverUrl} alt="" loading="lazy" />}
              </Link>
            ) : (
              <span
                key={w.weekId}
                className={`year-grid__cell cell cell--${w.state}`}
                title={`${w.weekId} — ${w.state}`}
              />
            ),
          )}
        </div>
      )}
    </div>
  );
}