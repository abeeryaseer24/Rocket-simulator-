# Ascent

A launch-vehicle ascent simulator for people who want to understand the engineering, not just watch a rocket go up.
Build or edit a vehicle, fly it to orbit in 3D, read the telemetry, and work through the theory behind every number.

**Audience:** undergraduate engineering students and anyone comfortable with first-year calculus and mechanics.

## Pages

| Page | Job |
|---|---|
| **Hangar** | Five reference vehicles drawn to one scale. Pick one to fly or edit. |
| **Flight** | Full-screen 3D ascent with HUD, event timeline, three cameras, time warp. `?at=<s>` opens a moment. |
| **Vehicle Bay** | One subsystem per screen: stages, engines, side boosters, payload and fairing, aerodynamics, guidance, launch site. Derived hand-calc values and sanity checks beside every input; a live flight check re-flies the vehicle after each edit. |
| **Telemetry** | One channel per view (16 channels), Δv loss ledger, event log with replay links. |
| **Academy** | Eleven lessons, each deriving an equation and giving an interactive figure that uses the same physics as the simulator. |

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
| Outputs | Osculating elements, integrated gravity/drag/steering losses, q, q·α, axial g |

Every kernel is unit-tested against published reference values (`npm test`): US76 tables to under 0.5 %, J2 surface
gravity, Kepler period, the γ = 1.4 isentropic table, and an orbit-insertion check for every reference vehicle.

### Known simplifications

These are deliberate and called out so nothing is taught as more exact than it is:

- No attitude dynamics or thrust-vector-control loop (3-DOF, not 6-DOF); thrust direction is commanded directly.
- No winds aloft, so angle of attack in the gravity turn is close to zero by construction.
- Solid motors burn with a flat (neutral-grain) thrust trace.
- Side boosters run at full thrust and aren't covered by the acceleration limit.
- No booster recovery or landing burns.
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
src/sim/       vehicle model, reference presets, simulate() integrator, pitch-kick tuner, store
src/three/     3D scene (camera-relative rendering, Earth/atmosphere/plume shaders)
src/pages/     Hangar, Flight, Vehicle Bay (+ bay/ sections), Telemetry, Academy
src/academy/   lessons and their interactive widgets
docs/design/   design baseline
```
