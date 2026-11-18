import { DEFAULT_CD } from '../physics/aero';
import type { EngineSpec } from '../physics/propulsion';
import { PRESETS, SITES } from './presets';
import { cloneVehicle, DEFAULT_RECOVERY, type StageSpec, type Vehicle } from './vehicle';

/**
 * Historic flights, rebuilt as replicas from rounded public figures. The
 * replica is flown by this simulator's own guidance, so it reaches a similar
 * orbit by a similar route, not an identical trajectory. Real orbits are
 * shown alongside for comparison.
 */

const eng = (e: Partial<EngineSpec> & Pick<EngineSpec, 'name' | 'thrustVac' | 'ispVac' | 'exitArea'>): EngineSpec => ({
  count: 1,
  throttleMin: 1,
  chamberPressure: 60,
  expansionRatio: 16,
  cycle: 'gas generator',
  ...e,
});

// R-7 family: four strap-on boosters (RD-107) around a sustainer core (RD-108), all lit on the pad
const r7Booster: StageSpec = {
  name: 'Strap-on booster (Blocks B, V, G, D)',
  dryMass: 3400,
  propMass: 39600,
  diameter: 2.68,
  length: 19.0,
  propellant: 'RP-1 / LOX',
  mixtureRatio: 2.47,
  engine: eng({ name: 'RD-107 (4 chambers)', thrustVac: 1000e3, ispVac: 306, exitArea: 1.85 }),
};
const r7Core: StageSpec = {
  name: 'Core stage (Block A)',
  dryMass: 7500,
  propMass: 86000,
  diameter: 2.95,
  length: 28.0,
  propellant: 'RP-1 / LOX',
  mixtureRatio: 2.39,
  engine: eng({ name: 'RD-108 (4 chambers)', thrustVac: 941e3, ispVac: 315, exitArea: 1.93 }),
};

function sputnikPS(): Vehicle {
  return {
    id: 'hist-sputnik',
    name: 'R-7 Sputnik (replica)',
    summary: 'The 8K71PS: an R-7 missile with its warhead replaced by an 83.6 kg sphere.',
    stages: [r7Core],
    boosters: { count: 4, stage: r7Booster, coreThrottleWhileAttached: 1 },
    fairing: { mass: 300, diameter: 1.0, length: 2.0, jettisonAltitude: 100e3 },
    payloadMass: 83.6,
    noseRadius: 0.5,
    cd: DEFAULT_CD,
    guidance: {
      verticalRiseTime: 10,
      pitchKickAngle: 13.5,
      pitchKickDuration: 10,
      targetAltitude: 228e3,
      targetInclination: 65.1,
      qBucketStart: 1e9,
      qBucketThrottle: 1,
      maxAxialG: 8,
      separationCoast: 1,
      ignitionDelay: 0,
    },
    site: SITES.baikonur,
  };
}

function vostokK(): Vehicle {
  return {
    ...sputnikPS(),
    id: 'hist-vostok',
    name: 'Vostok-K (replica)',
    summary: 'R-7 with the Block E third stage, carrying the 4.7 t Vostok spacecraft.',
    stages: [
      r7Core,
      {
        name: 'Third stage (Block E)',
        dryMass: 1440,
        propMass: 7000,
        diameter: 2.56,
        length: 3.1,
        propellant: 'RP-1 / LOX',
        mixtureRatio: 2.4,
        engine: eng({ name: 'RD-0109', thrustVac: 54.5e3, ispVac: 323, exitArea: 0.4, expansionRatio: 60 }),
      },
    ],
    fairing: { mass: 1500, diameter: 2.6, length: 5.0, jettisonAltitude: 100e3 },
    payloadMass: 4725,
    guidance: { ...sputnikPS().guidance, pitchKickAngle: 11.2, targetAltitude: 248e3, targetInclination: 64.95, separationCoast: 2, ignitionDelay: 2 },
  };
}

function saturnApollo11(): Vehicle {
  const v = cloneVehicle(PRESETS.find((p) => p.id === 'super-heavy-lunar')!);
  return { ...v, id: 'hist-apollo11', name: 'Saturn V AS-506 (replica)' };
}

function falcon9Orbcomm(): Vehicle {
  const v = cloneVehicle(PRESETS.find((p) => p.id === 'medium-kerolox')!);
  return {
    ...v,
    id: 'hist-f9-landing',
    name: 'Falcon 9 Flight 20 (replica)',
    payloadMass: 2100,
    recovery: { ...DEFAULT_RECOVERY, enabled: true, mode: 'rtls', reserveFraction: 0.16 },
    guidance: { ...v.guidance, pitchKickAngle: 3.9, targetAltitude: 620e3, targetInclination: 47 },
  };
}

export interface HistoricMission {
  id: string;
  title: string;
  date: string;
  where: string;
  vehicle: string;
  aboard: string;
  story: string[];
  facts: Array<[string, string]>;
  /** Real orbit achieved [km, km, deg] */
  realOrbit: { peri: number; apo: number; inc: number } | null;
  world: 'earth' | 'moon';
  /** Earth missions: the replica to fly in 3D */
  build?: () => Vehicle;
  /** Moon missions: the rocket in Other worlds */
  worldRocket?: string;
}

export const HISTORIC: HistoricMission[] = [
  {
    id: 'sputnik-1',
    title: 'Sputnik 1',
    date: '4 October 1957, 19:28 UTC',
    where: 'Baikonur, Kazakh SSR (Site 1)',
    vehicle: 'R-7 8K71PS',
    aboard: 'Sputnik 1, a polished 58 cm aluminium sphere of 83.6 kg',
    story: [
      'The first artificial satellite rode an intercontinental missile. The R-7 lit all five of its kerosene engines on the pad: four strap-on boosters peeled away after about two minutes, and the core stage burned on alone, all the way to orbit.',
      'The satellite carried little more than batteries and two radio transmitters, on 20.005 and 40.002 MHz. Radio amateurs worldwide could hear its beeps, which was the point. Its batteries lasted 21 days, and it re-entered on 4 January 1958.',
    ],
    facts: [
      ['Liftoff mass', 'about 267 t'],
      ['Engines', '5 (20 chambers) plus 12 vernier chambers'],
      ['Orbit', '215 × 939 km, 65.1°'],
      ['Period', '96.2 minutes'],
    ],
    realOrbit: { peri: 215, apo: 939, inc: 65.1 },
    world: 'earth',
    build: sputnikPS,
  },
  {
    id: 'vostok-1',
    title: 'Vostok 1',
    date: '12 April 1961, 06:07 UTC',
    where: 'Baikonur, Kazakh SSR (Site 1)',
    vehicle: 'Vostok-K (8K72K)',
    aboard: 'Yuri Gagarin, in the 4.7 t Vostok 3KA spacecraft',
    story: [
      'The first human spaceflight added a small third stage, Block E, to the R-7. Gagarin made a single orbit lasting 108 minutes, ejected from the descending capsule at about 7 km altitude, and landed by his own parachute near Engels.',
      'The third stage overperformed slightly and left Vostok in a higher orbit than planned. Had the retro-rocket failed, natural decay would still have brought him home within the week his supplies allowed.',
    ],
    facts: [
      ['Flight time', '108 minutes'],
      ['Orbit', '169 × 327 km, 64.95°'],
      ['Spacecraft mass', '4,725 kg'],
      ['Third-stage engine', 'RD-0109, about 54.5 kN'],
    ],
    realOrbit: { peri: 169, apo: 327, inc: 64.95 },
    world: 'earth',
    build: vostokK,
  },
  {
    id: 'apollo-11',
    title: 'Apollo 11 launch',
    date: '16 July 1969, 13:32 UTC',
    where: 'Launch Complex 39A, Kennedy Space Center',
    vehicle: 'Saturn V (AS-506)',
    aboard: 'Neil Armstrong, Buzz Aldrin and Michael Collins',
    story: [
      'The Saturn V was the most powerful rocket of its era. Five F-1 engines lifted 2,900 t off the pad, and in under twelve minutes three stages put Apollo 11 into a 186 × 183 km parking orbit. Two and a half hours later the third stage re-ignited for the Moon.',
      'The Validation tab compares this replica’s ascent with NASA’s post-flight records, event by event.',
    ],
    facts: [
      ['Liftoff mass', 'about 2,900 t'],
      ['First-stage thrust', '5 × F-1, about 34 MN at liftoff'],
      ['Parking orbit', '186 × 183 km, 32.5°'],
      ['Orbit insertion', '11 min 49 s after liftoff'],
    ],
    realOrbit: { peri: 183, apo: 186, inc: 32.52 },
    world: 'earth',
    build: saturnApollo11,
  },
  {
    id: 'apollo-11-lm',
    title: 'Apollo 11 lunar liftoff',
    date: '21 July 1969, 17:54 UTC',
    where: 'Tranquility Base, Mare Tranquillitatis, the Moon',
    vehicle: 'Lunar Module Eagle, ascent stage',
    aboard: 'Neil Armstrong and Buzz Aldrin, with 21.5 kg of lunar samples',
    story: [
      'The first launch from another world used a single, fixed engine with no backup. The ascent engine had to light, because there was no other way home. It burned hypergolic propellants that ignite on contact, fed by pressurised helium, with no pumps and as few moving parts as possible.',
      'The descent stage stayed behind as a launch pad. About seven minutes after liftoff Eagle was in a 17 × 83 km lunar orbit, and a few hours later it docked with Columbia.',
    ],
    facts: [
      ['Ascent engine', 'about 15.6 kN, Isp 311 s'],
      ['Burn time', 'about 7 minutes'],
      ['Insertion orbit', 'about 17 × 83 km'],
      ['Lunar surface stay', '21 h 36 min'],
    ],
    realOrbit: { peri: 17, apo: 83, inc: NaN },
    world: 'moon',
    worldRocket: 'lm-ascent',
  },
  {
    id: 'f9-flight-20',
    title: 'First orbital booster landing',
    date: '22 December 2015, 01:29 UTC',
    where: 'Space Launch Complex 40, Cape Canaveral',
    vehicle: 'Falcon 9 Full Thrust (Flight 20)',
    aboard: '11 ORBCOMM OG2 communications satellites',
    story: [
      'After delivering its satellites, the first stage turned around, flew back to the Cape and landed upright at Landing Zone 1, about ten minutes after liftoff. It was the first time an orbital-class booster had come back in one piece.',
      'The replica flies the same return-to-launch-site profile. Switch to the booster camera in the Flight view to follow the stage home.',
    ],
    facts: [
      ['Payload', '11 satellites, about 2 t'],
      ['Landing', 'Landing Zone 1, return to launch site'],
      ['Satellite orbit', 'low Earth orbit near 620 km, about 47°'],
      ['Booster', 'later put on display in Hawthorne, California'],
    ],
    realOrbit: { peri: 620, apo: 620, inc: 47 },
    world: 'earth',
    build: falcon9Orbcomm,
  },
];
