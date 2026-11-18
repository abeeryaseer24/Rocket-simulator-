import { Link } from 'react-router-dom';
import './about.css';

const CONTENTS = [
  ['what', 'What this is'],
  ['flight', 'How a flight is computed'],
  ['guidance', 'Guidance and staging'],
  ['screen', 'From numbers to pictures'],
  ['avionics', 'The electrical side'],
  ['evidence', 'How it is checked'],
  ['stack', 'Built with'],
  ['design', 'Design decisions'],
  ['limits', 'What it leaves out'],
  ['sources', 'References'],
] as const;

/** The pipeline from vehicle numbers to a drawn frame, one step per box. */
function Pipeline() {
  const steps = [
    ['Vehicle', 'stages, engines, masses, guidance targets'],
    ['simulate()', 'RK4 in an Earth-centred inertial frame, 20 ms steps'],
    ['Samples', 'one frame every 0.2 s burning, 1 s coasting'],
    ['Playback', 'interpolate continuous fields, hold discrete ones'],
    ['Scene + HUD', 'Three.js, rocket at the origin, Earth moved around it'],
  ];
  return (
    <ol className="ab-pipe" aria-label="Simulation pipeline">
      {steps.map(([h, p], i) => (
        <li key={h}>
          <span className="ab-pipe-n num">{i + 1}</span>
          <strong>{h}</strong>
          <span>{p}</span>
        </li>
      ))}
    </ol>
  );
}

export default function About() {
  return (
    <div className="ab">
      <header className="ab-head">
        <p className="ab-kicker">About</p>
        <h1>How Ascent works</h1>
        <p className="lede">
          A hobby project: a launch-vehicle simulator written from first principles, where every number on screen comes from an
          equation you can read. This page explains how it was built, from the physics kernels to the pixels.
        </p>
      </header>

      <div className="ab-layout">
        <nav className="ab-toc" aria-label="On this page">
          <ol>
            {CONTENTS.map(([id, label]) => (
              <li key={id}>
                <a href={`#${id}`}>{label}</a>
              </li>
            ))}
          </ol>
        </nav>

        <article className="ab-body">
          <section id="what">
            <h2>What this is</h2>
            <p>
              Ascent lets you design a rocket, fly it to orbit in 3D and then pull the flight apart. The telemetry, the losses,
              the electronics and the theory are all one click away. It runs entirely in the browser: no server and no account.
              Your design is stored only in your own browser and travels in the link when you share it.
            </p>
            <p>The pages each do one job:</p>
            <ul className="ab-pages">
              <li><Link to="/">Hangar</Link>: the scroll-driven night launch and the reference vehicles.</li>
              <li><Link to="/flight">Flight</Link>: the 3D ascent with countdown, gauges, audio and engine-out injection.</li>
              <li><Link to="/vehicle">Vehicle</Link>: edit one subsystem at a time, with hand-calculations beside every input.</li>
              <li><Link to="/telemetry">Telemetry</Link>: nineteen channels, the Δv loss ledger and the event log.</li>
              <li><Link to="/missions">Play</Link>: scored challenges, launches from the Moon and Mars, and replicas of historic flights.</li>
              <li><Link to="/analysis">Analysis</Link>: Monte Carlo, payload curves, the trajectory optimiser and validation.</li>
              <li><Link to="/avionics">Avionics</Link>: nine pages of electrical models, from batteries to error-correcting codes.</li>
              <li><Link to="/academy">Academy</Link>: thirteen lessons deriving the equations, each with a live figure.</li>
            </ul>
          </section>

          <section id="flight">
            <h2>How a flight is computed</h2>
            <Pipeline />
            <p>
              The vehicle is a point mass moving in an Earth-centred inertial frame (3 degrees of freedom). Every 20 ms the
              integrator asks one question: what is the acceleration right now? The answer is a sum of three forces:
            </p>
            <ul>
              <li>
                <strong>Gravity</strong>: a point mass plus the J2 term for Earth's equatorial bulge, with WGS-84 constants. That
                makes gravity about 0.5 % stronger at the poles.
              </li>
              <li>
                <strong>Thrust</strong>: F = F<sub>vac</sub> − p<sub>a</sub>·A<sub>e</sub>. The engine always swallows the same mass
                flow. Air pressure on the nozzle exit takes some thrust back, so sea-level specific impulse is derived, never typed in.
              </li>
              <li>
                <strong>Drag</strong>: ½ρv²·C<sub>D</sub>(M)·A, with air density from the US Standard Atmosphere 1976. The air moves
                with the rotating Earth, so drag uses the air-relative velocity.
              </li>
            </ul>
            <p>
              The state is advanced with classical fourth-order Runge–Kutta (RK4). When a tank would run dry partway through a step,
              the step is shortened to end exactly at depletion, so staging happens at the right instant. Alongside the motion the
              integrator keeps a ledger of where the Δv went: gravity loss, drag loss and steering loss. That ledger is what the
              telemetry page charts.
            </p>
            <p>
              Launches from the Moon and Mars use a separate planar simulator that is generic over the central body: its
              gravitational parameter, radius, rotation and atmosphere (none for the Moon, a NASA Glenn curve fit for Mars).
            </p>
            <p>
              Optional models switch on extra physics: a rigid-body pitch/yaw attitude model with a gimballed-engine autopilot and
              jet-stream wind, and a first-stage recovery model that flies the booster back for a propulsive landing.
            </p>
          </section>

          <section id="guidance">
            <h2>Guidance and staging</h2>
            <p>
              The first stage flies an open-loop recipe. It rises vertically to clear the tower, kicks over by a few degrees, then
              follows a zero-angle-of-attack gravity turn: the thrust points along the airflow, gravity bends the path, and the
              structure never feels a sideways load. Near maximum dynamic pressure the engines throttle into a "bucket", and late
              in each burn they throttle back to cap acceleration.
            </p>
            <p>
              Upper stages fly closed-loop. A linear vertical-acceleration law steers to null the altitude error and the climb rate
              at the predicted cutoff time. A second term steers out-of-plane velocity so the orbit lands on the target
              inclination. The engine cuts off when the orbital energy reaches the target. A sequencer handles the events between
              stages: booster separation, cutoff, a separation coast, ignition delay, and fairing jettison once the air is thin
              enough.
            </p>
            <p>
              The trajectory optimiser in Analysis tunes the open-loop part (rise time, kick angle and duration) with the
              Nelder–Mead simplex method, scoring each candidate by a full simulated flight.
            </p>
          </section>

          <section id="screen">
            <h2>From numbers to pictures</h2>
            <p>
              A flight produces a list of telemetry frames. Playback blends between neighbouring frames for smooth motion, but never
              blends discrete fields such as the stage number or whether an engine is burning. "Stage 1.4" does not exist, and
              blending it once froze the animation at staging.
            </p>
            <p>
              The 3D scene has to draw a 50 m rocket and a 12,700 km planet in one frame. Floating-point numbers lose precision far
              from the origin, so the scene uses camera-relative rendering. The rocket stays at the origin and the Earth is moved
              and rotated around it, with a logarithmic depth buffer so near and far surfaces sort correctly. The exhaust plume is a
              custom shader, and bloom and tone mapping give the night launch its glow. Engine sound is synthesised with the Web
              Audio API, and the countdown callouts use the browser's speech synthesis.
            </p>
            <p>
              Heavy jobs such as a thousand Monte Carlo flights or the optimiser run in a Web Worker, a background thread, so the
              page stays responsive while they compute.
            </p>
          </section>

          <section id="avionics">
            <h2>The electrical side</h2>
            <p>
              The <Link to="/avionics">Avionics</Link> section models the electronics a real vehicle would carry, all in software:
            </p>
            <ul>
              <li>A battery equivalent circuit driven by the flight's own events.</li>
              <li>An inertial navigation error model with a Kalman filter that blends in GNSS fixes.</li>
              <li>A radio link budget built from the flown geometry.</li>
              <li>Bit-exact CCSDS packets and MIL-STD-1553 bus words.</li>
              <li>A thrust-vector-control motor drive with its control loops and Bode plot.</li>
              <li>Pyrotechnic initiators calibrated to the NASA Standard Initiator ratings.</li>
              <li>Reliability maths for triple-voted computers and error-correcting memory.</li>
            </ul>
            <p>
              Component values are typical of their class, not copied from a specific product. Each page lists its sources and the
              assumptions it makes.
            </p>
          </section>

          <section id="evidence">
            <h2>How it is checked</h2>
            <p>
              Every physics kernel has unit tests against published reference values: atmosphere tables, WGS-84 surface gravity,
              Kepler periods, isentropic flow tables, CRC check values and the initiator no-fire and all-fire points. Every
              reference vehicle must reach orbit. There are 72 tests, and they run on every push through GitHub Actions, together
              with a type check and a production build.
            </p>
            <p>
              The <Link to="/analysis/validation">Validation</Link> tab shows the same checks live in your browser. It also flies
              the Saturn V-class preset against the Apollo 11 ascent record. Nothing there is tuned to match, so the differences
              show what the model leaves out.
            </p>
          </section>

          <section id="stack">
            <h2>Built with</h2>
            <dl className="ab-stack">
              <div><dt>Language</dt><dd>TypeScript, strict mode</dd></div>
              <div><dt>Interface</dt><dd>React 19, React Router 7</dd></div>
              <div><dt>3D</dt><dd>Three.js, custom GLSL shaders</dd></div>
              <div><dt>Motion</dt><dd>GSAP ScrollTrigger (Hangar), CSS keyframes</dd></div>
              <div><dt>Maths typesetting</dt><dd>KaTeX</dd></div>
              <div><dt>Build and tests</dt><dd>Vite, Vitest</dd></div>
              <div><dt>Browser APIs</dt><dd>Web Workers, Web Audio, Speech Synthesis, Compression Streams (share links)</dd></div>
              <div><dt>Hosting and CI</dt><dd>Vercel, GitHub Actions</dd></div>
            </dl>
            <p>
              The physics, guidance, avionics models and charts are written from scratch. There is no physics engine, charting
              library or UI kit, so every curve on screen traces back to code in this repository.
            </p>
          </section>

          <section id="design">
            <h2>Design decisions</h2>
            <ul>
              <li><strong>One job per page.</strong> Nothing is crammed into a dashboard. Each screen answers one question.</li>
              <li>
                <strong>Engineering-drawing palette.</strong> Frost and paper backgrounds, ink text, and a single Kapton-tape gold
                accent, with green and red reserved for go and abort.
              </li>
              <li>
                <strong>Type.</strong> Archivo, with its wide cut for headings and tabular figures so numbers don't jitter, and
                Source Serif 4 for lesson prose.
              </li>
              <li><strong>Charts.</strong> A three-colour series palette checked for colour-vision deficiency, direct labels instead of legends where possible.</li>
              <li><strong>Honesty.</strong> Every simplification is stated where it applies, not buried.</li>
            </ul>
          </section>

          <section id="limits">
            <h2>What it leaves out</h2>
            <ul>
              <li>Translation is 3-DOF. Optional attitude covers pitch and yaw, not roll.</li>
              <li>Wind is a single-direction model profile, not measured weather.</li>
              <li>Solid motors have a flat thrust trace. Side boosters are not acceleration-limited and are not recovered.</li>
              <li>Engines run at one mixture ratio, and there is no centre-engine early cutoff.</li>
              <li>Reference vehicles use rounded public figures. They are approximations, not flight data.</li>
              <li>The avionics models are teaching models. There is no real hardware in the loop.</li>
            </ul>
          </section>

          <section id="sources">
            <h2>References</h2>
            <ul className="ab-refs">
              <li>U.S. Standard Atmosphere, 1976. NOAA-S/T 76-1562.</li>
              <li>NIMA TR8350.2, Department of Defense World Geodetic System 1984 (3rd ed.).</li>
              <li>NACA Report 1135, Equations, Tables, and Charts for Compressible Flow (1953).</li>
              <li>G. P. Sutton and O. Biblarz, Rocket Propulsion Elements.</li>
              <li>Apollo 11 Mission Report (NASA MSC-00171) and Saturn V Flight Evaluation Report AS-506 (NASA MSFC).</li>
              <li>P. D. Groves, Principles of GNSS, Inertial, and Multisensor Integrated Navigation Systems (2nd ed.).</li>
              <li>B. Sklar, Digital Communications (2nd ed.).</li>
              <li>CCSDS 133.0-B Space Packet Protocol. MIL-STD-1553B. RCC 319.</li>
              <li>L. Bement, A Review of Pyrotechnic Devices and Systems, NASA RP-1326.</li>
              <li>G. Ellis, Control System Design Guide.</li>
            </ul>
            <p>
              Source code:{' '}
              <a href="https://github.com/abeeryaseer24/Rocket-simulator-" target="_blank" rel="noreferrer">
                github.com/abeeryaseer24/Rocket-simulator-
              </a>
            </p>
          </section>
        </article>
      </div>
    </div>
  );
}
