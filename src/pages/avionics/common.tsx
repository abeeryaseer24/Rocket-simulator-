import { useMemo, type ReactNode } from 'react';
import { simulate, type FlightResult } from '../../sim/simulate';
import { useSim } from '../../sim/store';

/** The last flown result, or a fresh flight of the current vehicle so every page has data. */
export function useFlight(): FlightResult {
  const { vehicle, result, stale } = useSim();
  return useMemo(() => (result && !stale ? result : simulate(vehicle)), [vehicle, result, stale]);
}

export function Intro({ title, kicker, children }: { title: string; kicker: string; children: ReactNode }) {
  return (
    <div className="av-intro">
      <p className="av-kicker">{kicker}</p>
      <h2>{title}</h2>
      <div className="av-prose">{children}</div>
    </div>
  );
}

export function Readouts({ children }: { children: ReactNode }) {
  return <dl className="av-readouts">{children}</dl>;
}

export function Workbench({ controls, children }: { controls: ReactNode; children: ReactNode }) {
  return (
    <div className="av-bench">
      <div className="av-controls">{controls}</div>
      <div className="av-out">{children}</div>
    </div>
  );
}

export function Block({ title, note, children }: { title: string; note?: ReactNode; children: ReactNode }) {
  return (
    <section className="av-block">
      <h3>{title}</h3>
      {note && <p className="an-note">{note}</p>}
      {children}
    </section>
  );
}

export function Sources({ children }: { children: ReactNode }) {
  return (
    <aside className="av-sources">
      <h4>Sources and assumptions</h4>
      {children}
    </aside>
  );
}

export const fmt = (v: number, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '—');
