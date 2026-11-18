# Ascent: a launch vehicle simulator for the web

Technical report

| | |
|---|---|
| Author | Talha Yaseer Abeer |
| Version | 1.0 |
| Date | 18 November 2026 |
| Live application | https://ascent-rocket.vercel.app |
| Source repository | https://github.com/abeeryaseer24/Rocket-simulator- |

## Contents

1. Summary
2. Scope and objectives
3. System overview
4. Technology stack
5. Flight dynamics model
6. Guidance, staging and recovery
7. Rendering and real-time playback
8. Avionics models
9. Analysis tools
10. Play modes: challenges, other worlds, historic flights
11. Verification and validation
12. Engineering practice
13. Limitations
14. Future work
15. References

Appendix A. Source layout
Appendix B. Reproducing the results

## 1. Summary

Ascent is a browser-based simulator of rocket launches to orbit. A user designs a vehicle or picks one of five reference designs, flies it in a 3D scene, and then examines the flight through telemetry, Monte Carlo analysis, an electrical systems section and a set of lessons that derive the governing equations. Every number shown on screen comes from a physics model in the repository; none is scripted.

The application is written in TypeScript with React and Three.js, runs entirely on the client and is deployed to Vercel from the `main` branch. The codebase is about 14,600 lines of TypeScript and 3,900 lines of CSS. All physics, guidance, avionics models and charts were written for this project without a physics engine, charting library or UI component kit.

The physics kernels are checked against published standards. Twenty-eight automated checks compare the atmosphere, gravity, orbital and nozzle models with the U.S. Standard Atmosphere 1976, WGS-84, NACA Report 1135 and the sidereal day, and all pass inside their stated tolerances. A Saturn V-class vehicle flown by the simulator's own guidance reaches Mach 1, maximum dynamic pressure and first-stage cutoff within 5 % of the Apollo 11 flight record, and matches the parking-orbit inclination to 0.02°. The test suite has 86 tests in 11 files and runs on every push through GitHub Actions.

## 2. Scope and objectives

The project set out to build a simulator that an engineering student could use to understand launch vehicle design, with the physical fidelity to make the numbers worth studying. The objectives were:

1. Model an ascent from pad to orbit with the effects that dominate real vehicle performance: Earth's oblateness and rotation, a standard atmosphere, Mach-dependent drag, pressure-dependent engine thrust and staging.
2. Fly the vehicle with closed-loop guidance, so that a design change produces a realistic change in the trajectory instead of a scripted path.
3. Present each result on a page with a single purpose, and show the hand calculation next to the simulated value wherever one exists.
4. Cover the electrical side of a launch vehicle (power, navigation, communications, data buses, actuation, pyrotechnics and fault tolerance) with software models, since no hardware was available for the project.
5. Verify the models against published data and state every simplification where it applies.

Out of scope: six-degree-of-freedom flight with roll, structural loads and bending modes, measured wind profiles, and any hardware in the loop.

## 3. System overview

The application is a single-page web application with nine top-level sections. Each section has one job.

| Section | Purpose |
|---|---|
| Hangar | Introduction: a scroll-driven night launch and the reference vehicles drawn to one scale |
| Flight | 3D ascent with countdown, instruments, engine audio, engine-out injection and a booster camera |
| Vehicle | Vehicle editor, one subsystem per screen, with derived values and sanity checks beside every input |
| Telemetry | Nineteen telemetry channels, the Δv loss ledger and the event log |
| Play | Eight scored challenges, launches from the Moon and Mars, and replicas of historic flights |
| Analysis | Monte Carlo dispersion, payload capacity, trajectory optimisation and validation |
| Avionics | Nine electrical system models driven by the last flight |
| Academy | Thirteen lessons, each deriving an equation and giving an interactive figure |
| About | How the project was built, with this report |

Data flows in one direction. The vehicle definition lives in a React context and is persisted in the browser's local storage. Flying the vehicle calls a pure function, `simulate(vehicle)`, which returns telemetry samples, discrete events, the final orbit and summary values such as maximum dynamic pressure and propellant margin. Every view reads that result. Nothing in the simulation layer depends on React, the DOM or Three.js, so the same code runs in the browser, in a Web Worker and in the test runner.

```
Vehicle definition ──> simulate() ──> FlightResult ──> Flight (3D scene, HUD)
      │                    │                      ├──> Telemetry charts
      │                    │                      ├──> Avionics models
      │                    │                      └──> Missions scoring
      │                    └── Web Worker ──> Monte Carlo, payload search, optimiser
      └── URL fragment (compressed) ──> shared designs
```

## 4. Technology stack

| Layer | Technology | Reason for the choice |
|---|---|---|
| Language | TypeScript 7, strict mode with no unused locals or parameters | Physical quantities pass through many layers; static types catch unit and shape errors before runtime |
| UI framework | React 19 with React Router 7 | Component model suits one-job pages; client-side routing gives deep links such as `/telemetry/q` and `/avionics/link` |
| 3D graphics | Three.js 0.187 with custom GLSL shaders | Direct control over the render loop, depth buffer and materials, which the planet-scale scene needs |
| Animation | GSAP ScrollTrigger and CSS keyframes | Scroll-scrubbed hero sequence on the Hangar page; CSS for everything React also styles |
| Mathematics typesetting | KaTeX | Fast, server-free rendering of the equations in the Academy |
| Build | Vite 8 | Native ES modules in development, code splitting per page, Web Worker bundling |
| Testing | Vitest 5 | Same module system as the application, so physics code is tested without a separate build |
| Browser APIs | Web Workers, Web Audio, Speech Synthesis, Compression Streams, Canvas 2D, ResizeObserver | Background computation, synthesised engine sound and callouts, compact share links, the planar flight player |
| Continuous integration | GitHub Actions on Ubuntu with Node 22 | Runs tests, type check and production build on every push and pull request |
| Hosting | Vercel | Static hosting with automatic deployment from `main` and a rewrite rule so every route serves the application |

The runtime has six dependencies: React, React DOM, React Router, Three.js, GSAP and KaTeX. Every chart in the application, from telemetry plots to Bode diagrams, is drawn by one in-house SVG component of about 270 lines that handles scaling, tick generation, logarithmic axes, decimation of long series, hover read-outs and direct labelling.

Pages are loaded on demand. The production build splits each section into its own chunk, so a visitor to the Academy does not download the 3D engine.

## 5. Flight dynamics model

### 5.1 Equations of motion

The vehicle is a point mass in an Earth-centred inertial frame. The state is position and velocity, integrated with the classical fourth-order Runge–Kutta method at a 20 ms step. When an engine would exhaust its propellant partway through a step, the step is shortened to end exactly at depletion, so staging happens at the correct instant and mass is conserved to rounding error.

The acceleration is the sum of gravity, thrust and drag, each divided by the current mass:

```
a = g_J2(r) + (F_thrust / m) · d̂ − (½ ρ v_rel² C_D(M) A / m) · v̂_rel
```

### 5.2 Earth model

Gravity includes the J2 zonal harmonic, which represents Earth's equatorial bulge. Constants are WGS-84: μ = 3.986004418 × 10¹⁴ m³/s², equatorial radius 6,378,137 m, flattening 1/298.257223563, rotation rate 7.2921159 × 10⁻⁵ rad/s. Positions convert between inertial, Earth-fixed and geodetic coordinates on the WGS-84 ellipsoid. The atmosphere co-rotates with the planet, so drag uses the velocity relative to the air.

### 5.3 Atmosphere

The U.S. Standard Atmosphere 1976 is implemented as its seven geopotential layers up to 86 km, each with a constant temperature lapse rate. Above 86 km the gas is no longer well mixed, so the model log-interpolates the tabulated values up to 1,000 km instead of extending the layer equations past their range.

### 5.4 Propulsion

Each engine is defined by vacuum thrust, vacuum specific impulse and nozzle exit area. Mass flow is fixed by the chamber, so thrust at ambient pressure p_a is

```
F(p_a) = F_vac − p_a · A_e,     ṁ = F_vac / (Isp_vac · g₀)
```

Sea-level specific impulse is therefore derived and never entered, which removes a common source of inconsistent input. Exit pressure follows from chamber pressure and expansion ratio through the isentropic area–Mach relation, which the Academy's nozzle lessons use to show over- and under-expansion.

### 5.5 Aerodynamics and heating

Drag uses a Mach-dependent coefficient table with the transonic rise and a reference area that changes as boosters and fairings separate. Stagnation-point heating uses the Sutton–Graves correlation. Dynamic pressure, the product of dynamic pressure and angle of attack, and axial acceleration are recorded for loads assessment.

### 5.6 Loss accounting

During integration the simulator accumulates the ideal Δv from the rocket equation and the three losses: gravity loss from thrusting against gravity, drag loss, and steering loss from thrust not aligned with velocity. The Telemetry section charts this ledger, which shows where each design spends its propellant.

### 5.7 Optional attitude dynamics

With attitude control enabled, the simulator adds a rigid-body pitch and yaw model. The centre of mass moves as tanks drain, the centre of pressure comes from the Barrowman method, and a gimballed-thrust autopilot holds the commanded attitude against a jet-stream wind profile. The static margin is reported, and a vehicle whose gimbal limit cannot overcome the aerodynamic moment departs controlled flight.

## 6. Guidance, staging and recovery

### 6.1 First stage

The first stage flies an open-loop gravity turn. It rises vertically to clear the tower, pitches over by a few degrees on the launch azimuth, then holds zero angle of attack so the thrust follows the air-relative velocity and the structure carries no side load. The throttle drops through a dynamic pressure bucket near maximum dynamic pressure and later limits axial acceleration.

The launch azimuth is solved from spherical trigonometry for the target inclination and corrected for the eastward velocity the pad already has from Earth's rotation.

### 6.2 Upper stages

Upper stages fly closed-loop. A linear vertical-acceleration guidance law steers to null the altitude error and the vertical velocity at the predicted cutoff time:

```
a_vertical = 6 Δh / t_go² − 4 ṙ / t_go
```

A second channel steers out-of-plane velocity to hold the target orbital plane. The engine cuts off when the orbital energy reaches that of the target circular orbit.

Vehicles with a single sustainer core and strap-on boosters, such as the R-7 family, switch from the open-loop turn to closed-loop guidance at booster separation, since the core flies on alone to orbit.

### 6.3 Sequencing

A sequencer handles booster separation, main engine cutoff, a separation coast, upper-stage ignition delay and fairing jettison once heating has fallen. Each transition is logged as an event with time, altitude and velocity.

### 6.4 First-stage recovery

When recovery is enabled, the spent first stage is flown separately after separation, either back to the launch site or to a drone ship placed at its unsteered impact point. The model covers boostback, an entry burn, a landing burn whose ignition time is chosen by forward prediction at 85 % throttle, and terminal guidance with a tilt limit of 25°. Propellant reserved for recovery cannot be burned on ascent, so recovery costs payload as it does on a real vehicle.

### 6.5 Trajectory optimisation

The open-loop pitch programme is tuned with a bounded Nelder–Mead simplex search over vertical-rise time, pitch-over angle and pitch-over duration. The objective is lexicographic: reach orbit first, then maximise the propellant left at cutoff. Each evaluation is a full simulated flight, results are memoised, and the search runs in a Web Worker and streams its progress to the page.

## 7. Rendering and real-time playback

### 7.1 Scale

The 3D scene must draw a 50 m vehicle and a 12,700 km planet in the same frame. Single-precision floating point on the GPU cannot hold both at once in world coordinates, so the scene uses camera-relative rendering. The vehicle stays at the origin and the Earth is translated and rotated around it each frame. A logarithmic depth buffer keeps near and distant surfaces sorted. A geodetic surface patch under the pad gives detail where the camera is close to the ground.

### 7.2 Visual effects

The exhaust plume is a custom shader whose shape widens as ambient pressure falls, as an under-expanded jet does at altitude. The night scene adds floodlights, beacons, a moon, city lights that fade with distance, an exhaust cloud of seventy sprites driven by mission time, and bloom with ACES tone mapping. Engine sound is synthesised with the Web Audio API, and countdown callouts use the browser's speech synthesis.

### 7.3 Playback

Telemetry is sampled every 0.2 s while an engine burns and every second while coasting. Playback interpolates continuous fields between samples and never interpolates discrete fields such as stage number or engine state. An earlier version did interpolate them, which caused a visible freeze at staging. Separation debris is animated only during continuous playback, so seeking to a later time shows the vehicle as it is then instead of replaying a separation.

### 7.4 Responsiveness

Monte Carlo runs, payload capacity searches and the optimiser run in a Web Worker. The interface stays interactive while hundreds of flights are computed, and long runs can be stopped.

## 8. Avionics models

The Avionics section models the electrical systems of a launch vehicle. Each page runs its own model on the flight the user last flew, and each lists its sources and assumptions. Component values are representative of their class, not taken from a specific product.

| Subsystem | Model | Checked against |
|---|---|---|
| Electrical power | First-order Thevenin equivalent circuit per Li-ion cell (open-circuit voltage as a function of charge, ohmic resistance, one RC pair), constant-power loads solved by fixed-point iteration, adiabatic I²R heating, load timeline from flight events | Energy drawn agrees with the charge removed to within 15 % |
| Inertial navigation | Eight-state planar error model (position, velocity, tilt, accelerometer and gyro bias) driven by the flown specific force; loosely coupled GNSS Kalman filter with Joseph-form covariance update; commercial receiver cutoff at 18 km and 515 m/s | Aided error stays bounded; navigation-grade drift is more than ten times lower than consumer MEMS |
| RF downlink | Friis free-space loss, parabolic dish gain, G/T, Eb/N₀ margin, Doppler shift, station elevation mask, coding thresholds | Free-space loss at 1,000 km and 2.25 GHz of 159.5 dB; BPSK bit error rate of 10⁻⁵ at 9.6 dB |
| Telemetry framing | CCSDS 133.0-B space packet primary header with APID and sequence count, fixed-point data words, CRC-16-CCITT | CRC check value 0x29B1 for "123456789"; header round trip; single-bit errors detected |
| Data bus | MIL-STD-1553B Manchester II word encoding with sync patterns and odd parity, message timing with response time and inter-message gap, minor-frame load table | 20 µs words; default schedule fits a 100 Hz frame |
| Thrust vector control | Brushless motor, gearbox and ball screw with cascaded current, velocity and position loops, voltage and current saturation, anti-windup, closed-form open-loop Bode plot | Phase margin above 45°; 2° step settles without overshoot |
| Pyrotechnics | Lumped bridgewire thermal model, capacitor discharge and current-limited battery firing circuits, inhibit chain | NASA Standard Initiator points: no fire at 1 A, fire within 10 ms at 3.5 A |
| Fault tolerance | Simplex, dual and triple-modular-redundant reliability, single-error-correcting double-error-detecting code, memory scrub interval | Every single-bit error corrected, double errors detected; TMR worse than simplex beyond ln 2 / λ |

The section opens with an interactive architecture diagram showing flight computers, sensors, actuators, power distribution, telemetry and an independent flight termination chain, each linked to the relevant standards.

## 9. Analysis tools

Monte Carlo dispersion. Each flight draws thrust, specific impulse, dry mass, propellant load, drag coefficient and pitch-over errors from normal distributions with configurable standard deviations and a reproducible seed. The page reports the probability of reaching orbit with a Wilson score 95 % confidence interval, a scatter of periapsis against apoapsis, a histogram of propellant margin and summary statistics.

Payload capacity. For a set of circular orbit altitudes, the simulator searches by bisection on the full simulation for the heaviest payload that still reaches a stable orbit, and plots the capacity curve.

Trajectory optimiser. Described in section 6.5. The result can be applied to the vehicle in one step.

Validation. Described in section 11.

## 10. Play modes: challenges, other worlds, historic flights

Challenges are eight scored missions, such as station resupply, the smallest rocket to orbit and an engine-out ascent. Each has requirement checks and a stored personal best.

Other worlds is a launch game set on the Moon and Mars, with Earth for comparison. It uses a separate planar simulator that is generic over the central body: gravitational parameter, mean radius, sidereal rotation and atmosphere. The Moon has no atmosphere. Mars uses the NASA Glenn Research Center curve fit to Mars Global Surveyor data. The player chooses a rocket and a flight plan (vertical rise, pitch-over angle and duration, target orbit, and either direct insertion or a coast and circularisation burn) and watches a canvas replay with follow and whole-orbit cameras. Results earn up to three stars. Any rocket can be flown on any world, which shows why Earth is the hard case: the lunar module ascent stage cannot lift itself off Mars or Earth.

Historic flights rebuild Sputnik 1, Vostok 1, the Apollo 11 launch, the Apollo 11 lunar liftoff and the first Falcon 9 booster landing as replicas from rounded public figures. Each page gives the date, place, crew or payload and a short account, and flies the replica on request with the real and simulated orbits side by side. All four Earth replicas reach orbit at the real inclination, and the Falcon 9 replica lands its booster at the launch site.

## 11. Verification and validation

### 11.1 Kernel verification

The Validation tab and the test suite run the same checks.

| Model | Reference | Quantities | Tolerance | Result |
|---|---|---|---|---|
| Atmosphere | U.S. Standard Atmosphere 1976, Table I | Temperature, pressure and density at seven altitudes from 0 to 80 km; sea-level speed of sound | 0.2 % on temperature, 0.5 % on pressure and density | 22 of 22 pass |
| Gravity | WGS-84 normal gravity | Surface gravity at equator and pole | 0.1 % | 2 of 2 pass |
| Orbits | Sidereal day, 86,164.09 s | Period at geostationary radius | 0.05 % | Pass |
| Nozzle | NACA Report 1135, γ = 1.4 | A/A* at Mach 2 and 3, p/p₀ at Mach 2 | 0.1 to 0.2 % | 3 of 3 pass |

### 11.2 Flight benchmark against Apollo 11

The Saturn V-class preset uses public stage masses and engine figures and is flown by the simulator's own guidance with no tuning toward the flight record.

| Event | Apollo 11 | Simulator | Difference |
|---|---|---|---|
| Mach 1 | 66.3 s | 69.5 s | +4.8 % |
| Maximum dynamic pressure | 83.0 s | 80.1 s | −3.5 % |
| Maximum dynamic pressure value | 35.2 kPa | 31.1 kPa | −11.7 % |
| First-stage outboard cutoff | 161.6 s | 165.8 s | +2.6 % |
| Second-stage cutoff | 548.2 s | 526.7 s | −3.9 % |
| Third-stage first cutoff | 699.3 s | 628.9 s | −10.1 % |
| Parking orbit | 186.0 × 183.2 km | 195.8 × 179.4 km | +9.8 / −3.8 km |
| Inclination | 32.52° | 32.50° | −0.02° |

The larger differences have identified causes. The real first stage shut down its centre engine early to cap acceleration, the second stage shifted mixture ratio mid-burn, and the preset aims for a 190 km circular orbit. None of these is modelled, and the Validation tab lists each cause beside the row it explains.

### 11.3 Automated tests

| Area | What the tests assert |
|---|---|
| Physics kernels | Atmosphere tables, J2 gravity, coordinate round trips, orbital elements, thrust and specific impulse at altitude, isentropic relations on both branches |
| Flight | Every reference vehicle reaches orbit; T/W below 1 does not lift off; the azimuth correction is exact for due-east launches; a vehicle short of propellant stays suborbital |
| Failures | Losing one of nine first-stage engines at T+60 s still reaches orbit with less margin; the flight is identical to nominal before the failure; losing the only upper-stage engine leaves the vehicle suborbital |
| Playback | Stage index and engine flags are never interpolated across a separation |
| Attitude | The centre of mass moves forward as tanks drain; a finless vehicle is statically unstable; a controlled vehicle flies through a jet stream within its gimbal limit; with almost no gimbal authority the airframe diverges |
| Recovery | The booster lands on the drone ship; return to launch site needs a bigger reserve and costs payload |
| Analysis | Monte Carlo runs reproduce from their seed; payload capacity falls with altitude; the optimiser never returns a worse trajectory than its starting point |
| Missions | Every mission evaluates for every preset; failure injection and payload requirements are enforced |
| Avionics | The checks in section 8 |
| Other worlds | Textbook surface gravity and escape speeds; every home rocket reaches a three-star orbit; impossible combinations fail as expected |
| Historic replicas | Each Earth replica reaches orbit at the real inclination; the Falcon 9 booster lands |

## 12. Engineering practice

Version control. The project history is in Git, with about forty commits on `main`. Each commit covers one subsystem change and states what changed, why, and the figures that support it.

Continuous integration. Every push and pull request runs the full test suite, the TypeScript type check and the production build on GitHub Actions. A change that breaks any of the three does not reach production.

Deployment. Vercel builds and deploys the `main` branch automatically. A rewrite rule serves the application for every route, so deep links such as `/avionics/power` or `/flight?at=120` open directly.

Separation of concerns. Physics, guidance and avionics code is pure TypeScript with no dependency on React or the browser. This made the models testable in Node, reusable in a Web Worker and safe to refactor.

State and persistence. The vehicle under edit is stored in local storage. Mission bests and world bests are stored per browser. A design can be shared as a link: the vehicle is serialised, compressed with the browser's Compression Streams API and carried in the URL fragment, so it is never sent to a server.

Accessibility. Pages use semantic landmarks and a skip-to-content link. The avionics architecture diagram is keyboard operable, and charts carry text alternatives and hover read-outs. The chart series colours were chosen to remain distinguishable with common forms of colour-vision deficiency. Motion-heavy effects respect the reduced-motion preference.

Responsive layout. Pages were checked at 375 px phone width and at desktop widths for horizontal overflow. On phones the navigation becomes a scrolling bottom bar.

Design system. The interface uses a small set of colour tokens drawn from engineering drawings (frost and paper backgrounds, ink text, one Kapton-tape gold accent, green and red reserved for go and abort), the Archivo typeface with tabular figures for numbers, and Source Serif 4 for lesson prose.

## 13. Limitations

These simplifications are deliberate and are stated in the application where they apply.

1. Translation is three-degree-of-freedom. The optional attitude model covers pitch and yaw only.
2. Wind is a single-direction model profile, not measured soundings.
3. Solid motors have a flat thrust trace. Side boosters are not acceleration limited and are not recovered.
4. Engines run at a single mixture ratio, and early centre-engine cutoff is not modelled.
5. Reference vehicles and historic replicas use rounded public figures. Replicas aim for circular orbits, so eccentric historic orbits such as Sputnik 1's are not reproduced.
6. The Moon and Mars simulator is planar, and the Mars atmosphere fit is intended for the lower atmosphere; temperature is floored at 130 K above that range.
7. Avionics models are teaching models with representative component values. There is no hardware in the loop.

## 14. Future work

1. Move the flight kernel to Rust compiled to WebAssembly and measure the speed-up for Monte Carlo runs.
2. Add roll and full six-degree-of-freedom dynamics with first-mode structural bending.
3. Fit the guidance to eccentric target orbits so historic replicas can match apogee as well as perigee.
4. Add a hardware-in-the-loop path: stream the simulated IMU and GNSS data over a serial link to a microcontroller running the navigation filter, and return its actuator commands to the simulator.

## 15. References

1. National Oceanic and Atmospheric Administration, NASA and U.S. Air Force. U.S. Standard Atmosphere, 1976. NOAA-S/T 76-1562.
2. National Imagery and Mapping Agency. Department of Defense World Geodetic System 1984. Technical Report 8350.2, 3rd edition.
3. Ames Research Staff. Equations, Tables, and Charts for Compressible Flow. NACA Report 1135, 1953.
4. G. P. Sutton and O. Biblarz. Rocket Propulsion Elements. Wiley.
5. NASA Manned Spacecraft Center. Apollo 11 Mission Report. MSC-00171, 1969.
6. NASA Marshall Space Flight Center. Saturn V Launch Vehicle Flight Evaluation Report, AS-506 Apollo 11 Mission, 1969.
7. P. D. Groves. Principles of GNSS, Inertial, and Multisensor Integrated Navigation Systems. Artech House, 2nd edition, 2013.
8. B. Sklar. Digital Communications: Fundamentals and Applications. Prentice Hall, 2nd edition.
9. Consultative Committee for Space Data Systems. Space Packet Protocol. CCSDS 133.0-B.
10. U.S. Department of Defense. MIL-STD-1553B, Digital Time Division Command/Response Multiplex Data Bus.
11. Range Commanders Council. Flight Termination Systems Commonality Standard. RCC 319.
12. L. J. Bement. A Review of Pyrotechnic Devices and Systems. NASA Reference Publication 1326.
13. G. Ellis. Control System Design Guide. Butterworth-Heinemann, 4th edition.
14. NASA Glenn Research Center. Mars Atmosphere Model, Metric Units.
15. D. P. Siewiorek and R. S. Swarz. Reliable Computer Systems: Design and Evaluation. A K Peters.

## Appendix A. Source layout

```
src/physics/    constants, vectors, atmosphere, Earth and gravity, orbits, propulsion, aerodynamics, nozzle
src/sim/        vehicle model, presets, simulate(), attitude, recovery, analysis worker,
                optimiser, validation, missions, other worlds, historic replicas, store
src/avionics/   power, navigation, RF link, CCSDS, MIL-STD-1553, TVC servo, pyrotechnics, reliability
src/three/      3D scene and shaders
src/pages/      one file or folder per section
src/academy/    lessons and interactive figures
src/components/ chart, instruments, form fields, shared navigation
```

## Appendix B. Reproducing the results

Requires Node.js 20 or newer.

```bash
npm install
npm test          # 86 tests: physics, flight, avionics, validation
npm run build     # type check and production bundle
npm run dev       # local server at http://localhost:5173
```

The validation tables in section 11 are produced live by the Validation tab at `/analysis/validation` and asserted by `src/sim/validation.test.ts`.
