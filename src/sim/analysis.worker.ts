/// <reference lib="webworker" />
import { maxPayload, monteCarloRun, type Dispersions } from './analysis';
import { optimiseAscent } from './optimise';
import type { Vehicle } from './vehicle';

export type WorkerRequest =
  | { type: 'mc'; vehicle: Vehicle; n: number; seed: number; d: Dispersions }
  | { type: 'payload'; vehicle: Vehicle; altitudes: number[] }
  | { type: 'optimise'; vehicle: Vehicle; maxIter: number };

let cancelled = false;

self.onmessage = (e: MessageEvent<WorkerRequest | { type: 'cancel' }>) => {
  const msg = e.data;
  if (msg.type === 'cancel') {
    cancelled = true;
    return;
  }
  cancelled = false;
  if (msg.type === 'mc') {
    const batch: unknown[] = [];
    for (let i = 0; i < msg.n && !cancelled; i++) {
      batch.push(monteCarloRun(msg.vehicle, msg.d, msg.seed, i));
      if (batch.length === 10 || i === msg.n - 1) {
        self.postMessage({ type: 'mc-progress', runs: batch.splice(0), done: i + 1 });
      }
    }
    self.postMessage({ type: 'done' });
  } else if (msg.type === 'payload') {
    msg.altitudes.forEach((alt, i) => {
      if (cancelled) return;
      self.postMessage({ type: 'payload-point', alt, kg: maxPayload(msg.vehicle, alt), done: i + 1 });
    });
    self.postMessage({ type: 'done' });
  } else if (msg.type === 'optimise') {
    const best = optimiseAscent(msg.vehicle, (step) => self.postMessage({ type: 'opt-step', step }), msg.maxIter);
    self.postMessage({ type: 'opt-done', x: best.x, evals: best.evals, margin: best.result.margin, outcome: best.result.outcome });
    self.postMessage({ type: 'done' });
  }
};
