import { useMemo, useState } from 'react';
import type { PeakFeature } from '../map/nearbyPeaks';

interface SearchFieldProps {
  peaks: PeakFeature[];
  /** Only surface peaks at or above this elevation (the active filter chip). */
  elevationFloor: number;
  onPick: (peak: PeakFeature) => void;
}

const MAX_RESULTS = 7;

function score(name: string, q: string): number {
  const n = name.toLowerCase();
  const i = n.indexOf(q);
  if (i < 0) return -1;
  // Prefix match beats mid-word match; shorter names beat longer.
  return (i === 0 ? 1000 : 500) - i - name.length * 0.1;
}

export default function SearchField({ peaks, elevationFloor, onPick }: SearchFieldProps) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();

  const results = useMemo(() => {
    if (q.length < 2) return [];
    return peaks
      .filter((f) => (f.properties.ele ?? 0) >= elevationFloor)
      .map((f) => ({ f, s: score(f.properties.name ?? '', q) }))
      .filter((r) => r.s >= 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, MAX_RESULTS)
      .map((r) => r.f);
  }, [peaks, q, elevationFloor]);

  return (
    <div className="card search">
      <span className="search__icon" aria-hidden />
      <input
        className="search__input"
        type="search"
        placeholder="Search peaks…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Search peaks by name"
      />
      {q.length >= 2 && (
        <ul className="search__results">
          {results.length === 0 ? (
            <li className="search__empty">No peak matches “{query.trim()}”.</li>
          ) : (
            results.map((f) => (
              <li key={f.properties.id}>
                <button
                  className="search__result"
                  onClick={() => {
                    onPick(f);
                    setQuery('');
                  }}
                >
                  <span>{f.properties.name}</span>
                  {f.properties.ele != null && (
                    <span className="search__result-ele">
                      {f.properties.ele.toLocaleString()} m
                    </span>
                  )}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
