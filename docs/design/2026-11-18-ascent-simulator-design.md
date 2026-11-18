# Ascent simulator — design

## Intent

A launch-vehicle ascent simulator that an undergraduate engineer can use to
*learn* the discipline: every number that drives the flight is visible,
editable, physically meaningful, and explained. The user builds a vehicle,
flies it, reads the telemetry, and understands why it made orbit (or didn't).

## Goals

- Physically correct ascent to orbit: rotating oblate Earth, standard
  atmosphere, Mach-dependent drag, pressure-dependent thrust, staging.
- Every input parameter editable; every derived quantity explained.
- Loss accounting (gravity, drag, steering) so Δv budgets close.
- Clean multi-page UI: one job per page.

## Non-goals (this phase)

- Full 6-DOF rigid-body attitude dynamics and TVC loops.
- Booster return / propulsive landing.
- Launch-site terrain, weather, winds aloft.

## Anti-goals

- A single crammed dashboard page or giant parameter table.
- "Game physics" — any shortcut that would teach something false.

## Approach

Considered:

1. **Unreal Engine** — best visuals, but cannot be hosted on Vercel or
   Streamlit; multi-GB client download kills the learning use case.
2. **Streamlit (Python)** — fast to build, but full-page rerender model
   cannot animate a live ascent; UI is generic by construction.
3. **Browser app: TypeScript physics core + React + Three.js on Vercel** —
   chosen. Deterministic RK4 integrator in TS runs a full ascent in well
   under a second; Three.js gives real-time 3D; static hosting.

## Physics model

| Domain      | Model |
|-------------|-------|
| Dynamics    | 3-DOF point mass, ECI frame, state (r, v, m) |
| Integrator  | Classical RK4, fixed 0.02 s step, event bisection to 1 ms |
| Gravity     | Point mass + J2 zonal harmonic (WGS-84 constants) |
| Earth       | Rotating, ω = 7.2921159e-5 rad/s; atmosphere co-rotates |
| Atmosphere  | US Standard Atmosphere 1976, 0–86 km geopotential layers; exponential fit to 1000 km |
| Aerodynamics| Axial drag, Cd(Mach) table, reference area from diameters of attached bodies |
| Propulsion  | F = F_vac − p_a·A_e ; ṁ = F_vac / (Isp_vac·g0); A_e derived from F_vac/F_sl |
| Throttle    | Max-Q bucket (q limit), axial-acceleration limit, min throttle |
| Guidance    | Vertical rise → pitch kick → gravity turn (α≈0) on stage 1; altitude/velocity closed-loop steering on upper stage to a target circular orbit |
| Heating     | Sutton–Graves stagnation heat flux |
| Outputs     | Osculating elements, Δv ideal vs delivered, losses, q, q·α, axial g |

## UI

Routes: `/` (hangar/home), `/flight`, `/vehicle/:subsystem`,
`/telemetry/:channel`, `/academy/:lesson`.

Visual system: frost `#E6EBEC`, prussian ink `#14233A`, graphite `#56636E`,
frost line `#C5D0D5`, Kapton `#B9821A`, abort red `#B3261E`. Archivo
(variable width) for UI and expanded-width headings; Source Serif 4 for
Academy prose. Flight page background is the sky colour computed from local
atmospheric density.

## Left to the builder

Preset numbers (from publicly published figures, approximated), chart
rendering, Earth shading, plume shader.
