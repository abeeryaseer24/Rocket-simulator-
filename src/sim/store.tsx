import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { PRESETS } from './presets';
import { simulate, type FlightResult } from './simulate';
import { cloneVehicle, type Vehicle } from './vehicle';

/**
 * App state: the vehicle being edited and the last flown result. The vehicle
 * is persisted per browser so a student's design survives a reload.
 */
interface Ctx {
  vehicle: Vehicle;
  setVehicle: (v: Vehicle) => void;
  update: (mut: (v: Vehicle) => void) => void;
  loadPreset: (id: string) => void;
  result: FlightResult | null;
  fly: () => FlightResult;
  /** True when the vehicle has been edited since the last flight */
  stale: boolean;
}

const KEY = 'ascent.vehicle.v1';
const load = (): Vehicle => {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as Vehicle;
  } catch {
    /* storage unavailable: fall through to default */
  }
  return cloneVehicle(PRESETS[0]);
};
const save = (v: Vehicle) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(v));
  } catch {
    /* ignore */
  }
};

const SimContext = createContext<Ctx | null>(null);

export function SimProvider({ children }: { children: ReactNode }) {
  const [vehicle, setV] = useState<Vehicle>(load);
  const [result, setResult] = useState<FlightResult | null>(null);
  const [stale, setStale] = useState(true);

  const setVehicle = useCallback((v: Vehicle) => {
    setV(v);
    save(v);
    setStale(true);
  }, []);
  const update = useCallback(
    (mut: (v: Vehicle) => void) => {
      setV((prev) => {
        const next = cloneVehicle(prev);
        mut(next);
        save(next);
        return next;
      });
      setStale(true);
    },
    [],
  );
  const loadPreset = useCallback(
    (id: string) => {
      const p = PRESETS.find((x) => x.id === id);
      if (p) setVehicle(cloneVehicle(p));
    },
    [setVehicle],
  );
  const fly = useCallback(() => {
    const r = simulate(vehicle);
    setResult(r);
    setStale(false);
    return r;
  }, [vehicle]);

  const value = useMemo(
    () => ({ vehicle, setVehicle, update, loadPreset, result, fly, stale }),
    [vehicle, setVehicle, update, loadPreset, result, fly, stale],
  );
  return <SimContext.Provider value={value}>{children}</SimContext.Provider>;
}

export function useSim(): Ctx {
  const c = useContext(SimContext);
  if (!c) throw new Error('useSim outside SimProvider');
  return c;
}
