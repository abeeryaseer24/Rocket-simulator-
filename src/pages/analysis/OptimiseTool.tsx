import { useEffect, useRef, useState } from 'react';
import Chart from '../../components/Chart';
import type { WorkerRequest } from '../../sim/analysis.worker';
import { OPT_VARS, type OptStep } from '../../sim/optimise';
import { useSim } from '../../sim/store';

interface Best {
  x: number[];
  evals: number;
  margin: number;
  outcome: string;
}

export default function OptimiseTool() {
  const { vehicle, update } = useSim();
  const [steps, setSteps] = useState<OptStep[]>([]);
  const [busy, setBusy] = useState(false);
  const [best, setBest] = useState<Best | null>(null);
  const [applied, setApplied] = useState(false);
  const worker = useRef<Worker | null>(null);
  useEffect(() => () => worker.current?.terminate(), []);

  const go = () => {
    worker.current?.terminate();
    setSteps([]);
    setBest(null);
    setApplied(false);
    setBusy(true);
    const w = new Worker(new URL('../../sim/analysis.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e) => {
      if (e.data.type === 'opt-step') setSteps((s) => [...s, e.data.step]);
      if (e.data.type === 'opt-done') setBest(e.data);
      if (e.data.type === 'done') setBusy(false);
    };
    worker.current = w;
    w.postMessage({ type: 'optimise', vehicle, maxIter: 60 } satisfies WorkerRequest);
  };
  const stop = () => {
    worker.current?.terminate();
    worker.current = null;
    setBusy(false);
  };
  const apply = () => {
    const x = best?.x ?? steps[steps.length - 1]?.x;
    if (!x) return;
    update((v) => OPT_VARS.forEach((ov, i) => (v.guidance[ov.key] = +x[i].toFixed(2))));
    setApplied(true);
  };

  const first = steps[0];
  const last = steps[steps.length - 1];
  const gain = last && first && last.outcome === 'orbit' ? (last.margin - (first.outcome === 'orbit' ? first.margin : 0)) / 1000 : NaN;

  return (
    <section className="an-tool">
      <div className="an-intro">
        <h2>Trajectory optimiser</h2>
        <p>
          Closed-loop guidance flies the upper stage, but the first seconds of flight are open-loop: how long to rise vertically,
          how hard to kick over, and how quickly. Those three choices shape the whole gravity turn. This tool searches them with the
          Nelder–Mead simplex method, a derivative-free optimiser that only needs to compare flights. It reaches orbit first, then
          maximises the propellant left at cutoff.
        </p>
      </div>
      <div className="an-controls">
        {busy ? (
          <button className="btn" onClick={stop}>
            Stop
          </button>
        ) : (
          <button className="btn" onClick={go}>
            Optimise ascent
          </button>
        )}
        {busy && (
          <span className="an-note">
            Iteration {steps.length}, {last?.evals ?? 0} flights so far
          </span>
        )}
        {!busy && last && (
          <button className="btn" onClick={apply} disabled={applied}>
            {applied ? 'Applied to vehicle' : 'Apply to vehicle'}
          </button>
        )}
      </div>
      {last && first && (
        <>
          <div className="an-headline">
            <div className="an-big num">{Number.isFinite(gain) ? `${gain >= 0 ? '+' : ''}${gain.toFixed(2)} t` : '—'}</div>
            <div>
              <strong>{last.outcome === 'orbit' ? 'propellant margin gained over your current pitch program' : 'still searching for a trajectory that reaches orbit'}</strong>
              <p className="num">
                Margin {(last.margin / 1000).toFixed(2)} t after {last.evals} simulated flights
                {first.outcome !== 'orbit' && ' · your starting trajectory did not reach orbit'}
              </p>
            </div>
          </div>
          <div className="an-block">
            <h3>Convergence</h3>
            <p className="an-note">Best flight in the simplex at each iteration. Flat steps are iterations that only shrank the search region.</p>
            <Chart
              series={[{ label: 'Margin', x: steps.map((s) => s.iter), y: steps.map((s) => (s.outcome === 'orbit' ? s.margin / 1000 : NaN)) }]}
              xLabel="Iteration"
              yLabel="Propellant margin (t)"
              height={260}
            />
          </div>
          <div className="an-block">
            <h3>Pitch program</h3>
            <table className="an-stats">
              <thead>
                <tr>
                  <th scope="col">Parameter</th>
                  <th scope="col">Current</th>
                  <th scope="col">Optimised</th>
                </tr>
              </thead>
              <tbody>
                {OPT_VARS.map((ov, i) => (
                  <tr key={ov.key}>
                    <th scope="row">{ov.label}</th>
                    <td className="num">
                      {first.x[i].toFixed(2)} {ov.unit}
                    </td>
                    <td className="num">
                      {last.x[i].toFixed(2)} {ov.unit}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="an-note">
              Nelder–Mead finds a local optimum: a different starting design can settle somewhere else. Apply it, then fly to see the
              new trajectory.
            </p>
          </div>
        </>
      )}
    </section>
  );
}
