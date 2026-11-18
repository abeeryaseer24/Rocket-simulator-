# Ascent

A launch-vehicle ascent simulator for people who want to understand the engineering, not just watch a rocket go up.
Build or edit a vehicle, fly it to orbit in 3D, read the telemetry, and work through the theory behind every number.

**Audience:** undergraduate engineering students and anyone comfortable with first-year calculus and mechanics.

Technical report: [docs/report.md](docs/report.md) covers the architecture, technology stack, physics and avionics models, verification against published data, and limitations.

## Pages

| Page | Job |
|---|---|
| **Hangar** | Scroll-driven climb from the pad to orbit (sky, stars and readouts from the atmosphere model), then five reference vehicles drawn to one scale. |
| **Flight** | Full-screen 3D ascent: readiness poll, terminal count, arc gauges, altitude tape, camera shake, engine audio, engine-out injection, booster camera. `?at=<s>` opens a moment. |
| **Vehicle Bay** | One subsystem per screen: stages, engines, side boosters, payload and fairing, aerodynamics, guidance, launch site. Derived hand-calc values and sanity checks beside every input; a live flight check re-flies the vehicle after each edit. |
| **Telemetry** | One channel per view (19 channels), Δv loss ledger, event log with replay links. |
| **Play** | Eight scored challenges with personal bests; **Other worlds**, a planar ascent game from the Moon and Mars (and Earth for comparison) with a canvas flight player and star ratings; **Historic flights**, replicas of Sputnik 1, Vostok 1, Apollo 11 (launch and lunar liftoff) and the first Falcon 9 landing, compared with the real orbits. |
| **Analysis** | Monte Carlo dispersion (P(orbit) with confidence interval, orbit scatter, margin histogram), payload-capacity curves, a Nelder–Mead pitch-program optimiser (all in a Web Worker), and a Validation tab comparing every kernel with published standards and the Saturn V-class preset with the Apollo 11 ascent. |
| **Avionics** | The electrical half of the vehicle, nine pages each running its own model on the last flight: architecture, power (Li-ion equivalent circuit against the event load timeline), navigation (INS error growth and a GNSS Kalman filter), RF downlink budget and Doppler, CCSDS telemetry packets with CRC, MIL-STD-1553B waveforms and bus loading, TVC actuator cascade control with Bode plot, pyrotechnic initiators and firing circuits, and fault tolerance (TMR, SECDED, scrubbing). |
| **Academy** | Thirteen lessons, each deriving an equation and giving an interactive figure that uses the same physics as the simulator, including a to-scale nozzle cutaway shaded by the isentropic flow field. |

Vehicle designs can be shared as a link (the design travels in the URL fragment, never to a server).

## Physics model

| Domain | Model |
|---|---|
| Dynamics | 3-DOF point mass in an Earth-centred inertial frame |
| Integrator | Classical RK4, 20 ms step, truncated exactly at propellant depletion |
| Gravity | Point mass + J2 (WGS-84 constants) |
| Earth | WGS-84 ellipsoid, rotating at 7.2921159e-5 rad/s; atmosphere co-rotates |
| Atmosphere | US Standard Atmosphere 1976: seven geopotential layers to 86 km, tabulated log-interpolation to 1000 km |
| Aerodynamics | Axial drag, C_D(Mach) table, reference area from attached bodies |
| Propulsion | F = F_vac − p_a·A_e, ṁ = F_vac / (Isp_vac·g₀); sea-level Isp is derived, never input |
| Nozzle | Isentropic area–Mach relation (academy) for exit pressure and expansion state |
| Throttle | Max-Q bucket with hysteresis, axial-g limit, core throttle-back with boosters, minimum throttle |
| Guidance | Stage 1: vertical rise, pitch kick, α = 0 gravity turn. Upper stages: linear vertical-acceleration law nulling Δh and ṙ at t_go, with v_go-based yaw steering to hold the target plane. Cutoff on orbital energy. |
| Launch azimuth | Spherical-trig inertial azimuth corrected for pad rotation |
| Heating | Sutton–Graves stagnation-point convective flux |
| Attitude (optional) | Rigid-body pitch/yaw with moving CG and inertia, Barrowman CP, gimballed-thrust PD autopilot, jet-stream wind |
| Recovery (optional) | Stage 1 flown home after separation: boostback (RTLS) or droneship, entry burn, predictive hoverslam landing burn, grid-fin and terminal guidance |
| Failures | Engine-out injection at any time on the active stage |
| Outputs | Osculating elements, integrated gravity/drag/steering losses, q, q·α, axial g |

## Avionics models

| Subsystem | Model | Checked against |
|---|---|---|
| Power | First-order Thevenin Li-ion cell (OCV(SOC), R₀, R₁C₁), constant-power loads, adiabatic I²R heating | Energy balance vs ΔSOC |
| Navigation | 8-state planar INS error model, loosely-coupled GNSS Kalman filter (Joseph form), CoCom cutoff | Aided error bounded, grade ordering |
| RF link | Friis loss, dish gain, G/T, Eb/N₀ margin, Doppler; BPSK BER via erfc | 9.6 dB at BER 10⁻⁵; FSPL at 1000 km |
| Telemetry | CCSDS 133.0-B Space Packet header, CRC-16-CCITT | CRC check value 0x29B1, header round-trip |
| Data bus | MIL-STD-1553B Manchester II words, odd parity, message timing, minor-frame loading | 20 µs words, frame budget |
| TVC actuator | BLDC + gearbox + ball screw, current/velocity/position PI cascade with saturation, small-signal Bode | Phase margin > 45°, step settles |
| Pyrotechnics | Lumped bridgewire thermal model, CDU and current-limited firing | NSI 1 A / 1 W no-fire, 3.5 A all-fire |
| Fault tolerance | Simplex/dual/TMR reliability, SECDED (8,4), scrub-interval error model | All single errors corrected, doubles detected |

Each page lists its sources and assumptions. Component values are representative of their class, not of a specific product.

Every kernel is unit-tested against published reference values (`npm test`): US76 tables to under 0.5 %, J2 surface
gravity, Kepler period, the γ = 1.4 isentropic table, and an orbit-insertion check for every reference vehicle.

### Known simplifications

These are deliberate and called out so nothing is taught as more exact than it is:

- Attitude dynamics cover pitch and yaw only (no roll), and are off by default; with them off, thrust points exactly where guidance commands.
- Wind is a single-direction profile (surface breeze plus a Gaussian jet stream), not measured soundings.
- Solid motors burn with a flat (neutral-grain) thrust trace.
- Side boosters run at full thrust, aren't covered by the acceleration limit, and are not recovered.
- Booster recovery ignores the flip manoeuvre's dynamics (a timed coast) and models grid fins as a bounded lateral acceleration.
- Reference vehicles use rounded public figures. They are teaching approximations, not flight data.

## Running locally

Requires Node.js 20 or newer.

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # physics and flight tests
npm run build    # production bundle in dist/
```

## Deploying to Vercel

1. Sign in at vercel.com and choose **Add New → Project**.
2. Import this GitHub repository. Vercel detects Vite automatically (build `npm run build`, output `dist`).
3. Deploy. `vercel.json` already rewrites all routes to `index.html` so deep links like `/telemetry/q` work.

## Code map

```
src/physics/   constants, vectors, atmosphere, Earth/gravity, orbits, propulsion, aero, nozzle
src/sim/       vehicle model, presets, simulate(), attitude/TVC, recovery, analysis worker, optimiser, validation, missions, store
src/avionics/  power, navigation (Kalman), RF link, CCSDS, MIL-STD-1553, TVC servo, pyro, reliability
src/three/     3D scene (camera-relative rendering, Earth/atmosphere/plume shaders)
src/pages/     Hangar, Flight, Vehicle Bay (+ bay/), Telemetry, Missions, Analysis (+ analysis/), Avionics (+ avionics/), Academy
src/academy/   lessons and their interactive widgets
docs/design/   design baseline
```
