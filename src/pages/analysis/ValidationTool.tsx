import { useMemo } from 'react';
import { PRESETS } from '../../sim/presets';
import { simulate } from '../../sim/simulate';
import { APOLLO11_SOURCE, apollo11Benchmark, kernelChecks, passes } from '../../sim/validation';

const fmtv = (v: number) => (Math.abs(v) >= 1000 ? v.toFixed(0) : Math.abs(v) >= 1 ? v.toPrecision(6) : v.toPrecision(5));

export default function ValidationTool() {
  const checks = useMemo(kernelChecks, []);
  const bench = useMemo(() => apollo11Benchmark(simulate(PRESETS.find((p) => p.id === 'super-heavy-lunar')!)), []);
  const nPass = checks.filter(passes).length;
  const groups = [...new Set(checks.map((c) => c.group))];
  return (
    <section className="an-tool">
      <div className="an-intro">
        <h2>Validation</h2>
        <p>
          A simulator is only as good as its evidence. Every physics kernel is checked here against a published standard. The
          Saturn V-class preset is then flown and compared with the real Apollo 11 ascent. Nothing on this page has been tuned to
          match, so the differences show what the model leaves out.
        </p>
      </div>
      <div className="an-headline">
        <div className="an-big num">
          {nPass}/{checks.length}
        </div>
        <div>
          <strong>kernel checks inside tolerance</strong>
          <p>Computed live in your browser, from the same code the flights use.</p>
        </div>
      </div>
      {groups.map((g) => (
        <div className="an-block" key={g}>
          <h3>{g}</h3>
          <p className="an-note">{checks.find((c) => c.group === g)!.source}</p>
          <table className="an-stats">
            <thead>
              <tr>
                <th scope="col">Quantity</th>
                <th scope="col">Reference</th>
                <th scope="col">Ascent</th>
                <th scope="col">Error</th>
                <th scope="col">Tolerance</th>
              </tr>
            </thead>
            <tbody>
              {checks
                .filter((c) => c.group === g)
                .map((c) => (
                  <tr key={c.quantity}>
                    <th scope="row">{c.quantity}</th>
                    <td className="num">
                      {fmtv(c.reference)} {c.unit}
                    </td>
                    <td className="num">{fmtv(c.computed)}</td>
                    <td className="num">{(((c.computed - c.reference) / c.reference) * 100).toFixed(3)} %</td>
                    <td className="num" style={{ color: passes(c) ? 'var(--go)' : 'var(--abort)' }}>
                      {passes(c) ? 'pass' : 'FAIL'} · ±{(c.tol * 100).toFixed(2)} %
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ))}
      <div className="an-block">
        <h3>Flight benchmark: Apollo 11 ascent</h3>
        <p className="an-note">
          The Super-heavy lunar preset is a Saturn V-class vehicle built from public stage masses and engine figures and flown by
          this simulator's own guidance. Reference: {APOLLO11_SOURCE}
        </p>
        <table className="an-stats">
          <thead>
            <tr>
              <th scope="col">Event</th>
              <th scope="col">Apollo 11</th>
              <th scope="col">Ascent</th>
              <th scope="col">Difference</th>
            </tr>
          </thead>
          <tbody>
            {bench.map((b) => {
              const d = b.simulated === null ? null : b.simulated - b.reference;
              return (
                <tr key={b.quantity}>
                  <th scope="row">
                    {b.quantity}
                    {b.note && (
                      <p className="an-note" style={{ margin: '2px 0 0', fontWeight: 400 }}>
                        {b.note}
                      </p>
                    )}
                  </th>
                  <td className="num">
                    {b.reference} {b.unit}
                  </td>
                  <td className="num">{b.simulated === null ? 'not modelled' : `${b.simulated.toFixed(1)} ${b.unit}`}</td>
                  <td className="num">{d === null ? '—' : `${d >= 0 ? '+' : ''}${d.toFixed(1)} (${((d / b.reference) * 100).toFixed(1)} %)`}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
