import { useEffect, useId, useState, type ReactNode } from 'react';

interface NumProps {
  label: string;
  hint?: ReactNode;
  /** Stored SI value */
  value: number;
  onChange: (v: number) => void;
  unit?: string;
  /** Display = stored × scale (e.g. 0.001 to show kg as t) */
  scale?: number;
  step?: number;
  min?: number;
  max?: number;
  digits?: number;
}

/**
 * Numeric field. Keeps the typed text locally so half-typed values ("1.")
 * aren't clobbered, and commits only valid numbers inside [min, max].
 */
export function NumField({ label, hint, value, onChange, unit, scale = 1, step, min, max, digits = 4 }: NumProps) {
  const id = useId();
  const shown = +(value * scale).toPrecision(digits + 2);
  const [text, setText] = useState(String(shown));
  const [bad, setBad] = useState(false);
  useEffect(() => {
    setText(String(+(value * scale).toPrecision(digits + 2)));
    setBad(false);
  }, [value, scale, digits]);
  const commit = (t: string) => {
    const n = Number(t);
    const lo = min ?? -Infinity;
    const hi = max ?? Infinity;
    if (t.trim() === '' || !Number.isFinite(n) || n < lo || n > hi) {
      setBad(true);
      return;
    }
    setBad(false);
    onChange(n / scale);
  };
  return (
    <div className={'field' + (bad ? ' bad' : '')}>
      <label htmlFor={id}>{label}</label>
      {hint && <p className="hint">{hint}</p>}
      <div className="control">
        <input
          id={id}
          type="number"
          inputMode="decimal"
          value={text}
          step={step ?? 'any'}
          min={min}
          max={max}
          onChange={(e) => {
            setText(e.target.value);
            commit(e.target.value);
          }}
          aria-invalid={bad}
        />
        {unit && <span className="unit">{unit}</span>}
      </div>
      {bad && (
        <p className="hint err">
          Enter a number{min !== undefined ? ` from ${min}` : ''}
          {max !== undefined ? ` to ${max}` : ''}.
        </p>
      )}
    </div>
  );
}

interface SelectProps<T extends string> {
  label: string;
  hint?: ReactNode;
  value: T;
  options: readonly T[] | Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
}

export function SelectField<T extends string>({ label, hint, value, options, onChange }: SelectProps<T>) {
  const id = useId();
  const opts = (options as Array<T | { value: T; label: string }>).map((o) => (typeof o === 'string' ? { value: o, label: o } : o));
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {hint && <p className="hint">{hint}</p>}
      <div className="control">
        <select id={id} value={value} onChange={(e) => onChange(e.target.value as T)}>
          {opts.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

export function TextField({ label, hint, value, onChange }: { label: string; hint?: ReactNode; value: string; onChange: (v: string) => void }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {hint && <p className="hint">{hint}</p>}
      <div className="control">
        <input id={id} type="text" value={value} onChange={(e) => onChange(e.target.value)} />
      </div>
    </div>
  );
}

/** A derived quantity in the "what this means" column. */
export function Derived({ label, value, unit, note, warn }: { label: string; value: string; unit?: string; note?: ReactNode; warn?: boolean }) {
  return (
    <div className={'derived' + (warn ? ' warn' : '')}>
      <dt>{label}</dt>
      <dd className="num">
        {value}
        {unit && <small>{unit}</small>}
      </dd>
      {note && <p>{note}</p>}
    </div>
  );
}
