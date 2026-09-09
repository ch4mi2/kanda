interface FilterChipsProps {
  value: number;
  onChange: (floor: number) => void;
}

// Repointed from the design's trail filters ("Sunrise / Under 6 km / No
// permit") to what actually matters for peak identification: how high a
// summit has to be to show up. The highland core has hundreds of named
// bumps; this thins them to the ones a person would recognise.
const OPTIONS: Array<{ label: string; floor: number }> = [
  { label: 'All peaks', floor: 0 },
  { label: '1,000 m+', floor: 1000 },
  { label: '1,500 m+', floor: 1500 },
  { label: '2,000 m+', floor: 2000 },
];

export default function FilterChips({ value, onChange }: FilterChipsProps) {
  return (
    <div className="chips" role="group" aria-label="Filter peaks by elevation">
      {OPTIONS.map((o) => (
        <button
          key={o.floor}
          className={`chip ${value === o.floor ? 'chip--active' : ''}`}
          aria-pressed={value === o.floor}
          onClick={() => onChange(o.floor)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
