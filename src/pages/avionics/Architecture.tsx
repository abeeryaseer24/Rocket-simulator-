import { useState } from 'react';
import { Intro, Sources } from './common';

interface Node {
  id: string;
  label: string;
  sub: string;
  x: number;
  y: number;
  w?: number;
  title: string;
  body: string;
  facts: string[];
}

const NODES: Node[] = [
  {
    id: 'fc',
    label: 'Flight computers ×3',
    sub: 'GNC software, voting',
    x: 330,
    y: 40,
    w: 220,
    title: 'Flight computers (triplex)',
    body: 'Three identical processor lanes run the same guidance, navigation and control software on the same inputs, frame by frame, and vote on every output. A lane that disagrees is outvoted and can be taken offline. This is the avionics equivalent of engine-out capability.',
    facts: [
      'Radiation-hardened processors such as the BAE Systems RAD750 (PowerPC 750 family, flown on the Curiosity and Perseverance rovers) and the Cobham Gaisler GR712RC (dual-core LEON3FT, SPARC V8) are the usual choice for long missions.',
      'A launch lasts minutes, so the total radiation dose is tiny. Some launchers use commercial processors in voting sets and rely on redundancy rather than hardened silicon.',
      'Typical GNC frame rates are 25 to 100 Hz, with the inner attitude loop running fastest. The Data bus page schedules this traffic.',
    ],
  },
  {
    id: 'imu',
    label: 'IMU',
    sub: '3 gyros + 3 accels',
    x: 30,
    y: 210,
    title: 'Inertial measurement unit',
    body: 'Three gyroscopes and three accelerometers bolted to the structure (strapdown). The flight computer integrates their angular and velocity increments into attitude, velocity and position: inertial navigation. It needs no outside signal, so it cannot be jammed, but its errors grow without bound.',
    facts: [
      'Ring-laser and fibre-optic gyros dominate launch vehicles. MEMS sensors are catching up for small launchers.',
      'Outputs are usually Δθ and Δv increments at 100 to 400 Hz, so no information is lost between samples.',
      'The Navigation page simulates the drift of three sensor grades along your trajectory.',
    ],
  },
  {
    id: 'gnss',
    label: 'GNSS receiver',
    sub: 'GPS / Galileo',
    x: 170,
    y: 210,
    title: 'GNSS receiver',
    body: 'Satellite navigation bounds the inertial drift. A Kalman filter blends the two: the IMU supplies smooth, high-rate motion and GNSS corrects its slow errors. GNSS also gives range safety an independent position track.',
    facts: [
      'Commercial receivers must stop giving fixes above 18 km altitude and 515 m/s (the "CoCom" export limits). Launch vehicles fly space-qualified receivers that are licensed without them.',
      'Antennas are wrap-around or patch arrays on the interstage and fairing. The plume and the vehicle body block parts of the sky.',
    ],
  },
  {
    id: 'ecu',
    label: 'Engine controller',
    sub: 'valves, igniters',
    x: 310,
    y: 210,
    title: 'Engine control unit',
    body: 'Runs the engine start and shutdown sequences, closes loops on chamber pressure and mixture ratio, and watches redlines: turbopump speed, temperatures, pressures. It can shut an engine down in milliseconds, faster than any ground controller.',
    facts: [
      'Sensors: pressure transducers (strain-gauge bridges), thermocouples and RTDs, turbine speed pickups, accelerometers for combustion stability.',
      'Actuators: solenoid and motorised valves, spark or pyrophoric igniters. The Power page budgets their current.',
    ],
  },
  {
    id: 'tvc',
    label: 'TVC actuators',
    sub: 'pitch + yaw EMA',
    x: 450,
    y: 210,
    title: 'Thrust vector control actuators',
    body: 'Two actuators per gimballed engine swing the nozzle a few degrees in pitch and yaw. Hydraulic actuators were standard for decades. Electromechanical actuators (a brushless motor, gearbox and ball screw) are now common because they need no hydraulic fluid, pumps or accumulators.',
    facts: [
      'Typical requirements: ±5 to 8° of travel, 20 to 60°/s slew, small-signal bandwidth above 5 to 10 Hz, so the control system has phase margin left over for bending modes.',
      'EMAs often run from their own high-voltage battery (hundreds of volts), separate from the 28 V avionics bus.',
      'The TVC actuator page simulates the motor, its three cascaded loops and a Bode plot.',
    ],
  },
  {
    id: 'pdu',
    label: 'Power distribution',
    sub: 'battery, 28 V bus',
    x: 30,
    y: 380,
    w: 170,
    title: 'Electrical power system',
    body: 'A lithium-ion battery feeds a regulated or semi-regulated 28 V bus through solid-state power controllers. These are electronic circuit breakers that switch each load and trip on overcurrent. Before liftoff the vehicle runs on ground power through the umbilical, then transfers to internal batteries minutes before launch.',
    facts: [
      '28 V DC is the aerospace standard bus (MIL-STD-704 for aircraft, and widely used on spacecraft and launchers).',
      'Every box draws through its own protected channel, so a short in one load cannot take the bus down.',
      'The Power page runs an equivalent-circuit battery model against the load timeline of your flight.',
    ],
  },
  {
    id: 'pyro',
    label: 'Pyro controller',
    sub: 'sequencer, S&A',
    x: 240,
    y: 380,
    title: 'Pyrotechnic sequencer',
    body: 'Fires the separation nuts, linear shaped charges and pushers at staging and fairing jettison. Firing requires several independent conditions at once: the safe-and-arm device mechanically armed, an arm command, then a fire command, often from two separate lanes.',
    facts: [
      'Hot-bridgewire initiators such as the NASA Standard Initiator are rated "1 A / 1 W no-fire for 5 minutes, 3.5 A all-fire": stray currents cannot set them off, but a firing pulse always does.',
      'The Pyrotechnics page models the bridgewire heating under a capacitor-discharge firing circuit.',
    ],
  },
  {
    id: 'tlm',
    label: 'Telemetry',
    sub: 'encoder + S-band TX',
    x: 450,
    y: 380,
    title: 'Telemetry system',
    body: 'A data acquisition unit samples hundreds of sensors, the encoder packs them with flight computer data into a serial stream, and an S-band transmitter sends it to ground stations and relay satellites. It is how engineers know what happened on a flight that did not come back.',
    facts: [
      'Formats: IRIG 106 PCM frames (the US range standard) or CCSDS space packets (the space agency standard).',
      'Rates from hundreds of kbit/s to over 10 Mbit/s. Video downlinks use separate channels.',
      'The RF link and Telemetry packets pages cover the radio budget and the bit-level framing.',
    ],
  },
  {
    id: 'fts',
    label: 'Flight termination',
    sub: 'independent chain',
    x: 640,
    y: 380,
    w: 170,
    title: 'Flight termination system',
    body: 'An independent safety chain with its own batteries, receivers or autonomous logic, and initiators, wired to destroy the vehicle if it leaves its safety corridor. It shares nothing with the flight computers, so a guidance failure cannot also disable the system meant to stop it.',
    facts: [
      'US launches follow FAA rules (14 CFR Part 450) and range standards such as RCC 319, the flight termination systems commonality standard.',
      'Autonomous systems (AFTS) carry the destruct rules on board and decide from their own GNSS/IMU state. SpaceX has flown one since 2017.',
    ],
  },
  {
    id: 'sens',
    label: 'Sensor conditioning',
    sub: 'bridges, filters, ADC',
    x: 640,
    y: 210,
    w: 170,
    title: 'Sensor signal conditioning',
    body: 'Raw sensors produce millivolts. Conditioning electronics excite strain-gauge bridges, amplify, apply anti-alias low-pass filtering below half the sample rate (Nyquist), and digitise with 12 to 24-bit ADCs. Thermocouples need cold-junction compensation.',
    facts: [
      'Vibration channels may sample at 10 to 50 kHz, structural temperatures at 1 Hz. The encoder interleaves both in one frame by sub- and super-commutation.',
    ],
  },
  {
    id: 'umb',
    label: 'Ground umbilical',
    sub: 'power, data, T-0',
    x: 640,
    y: 40,
    w: 170,
    title: 'Ground umbilical',
    body: 'Before liftoff, ground power, a wired data link to the launch control centre and propellant loading all come through umbilicals. Internal power transfer happens minutes before launch. The umbilicals disconnect at T-0, and from then on the vehicle is on its own.',
    facts: ['The launch sequencer on the ground runs the terminal count and can hold or abort right up to engine ignition.'],
  },
];

const by = (id: string) => NODES.find((n) => n.id === id)!;
const cx = (n: Node) => n.x + (n.w ?? 120) / 2;

export default function Architecture() {
  const [sel, setSel] = useState('fc');
  const node = by(sel);
  const busY = 160;
  const W = 840;
  const H = 470;
  const dataNodes = ['imu', 'gnss', 'ecu', 'tvc', 'sens'];
  const lowerData = ['pyro', 'tlm'];
  return (
    <section>
      <Intro title="Avionics architecture" kicker="01 · System">
        <p>
          A launch vehicle carries a small distributed computer network. One set of flight computers is the bus controller. Sensors
          and actuators are remote terminals on a shared data bus, a power system feeds everything, and a completely separate chain
          exists only to end the flight safely. Select a box to see what it does and how real vehicles build it.
        </p>
      </Intro>
      <div className="av-arch">
        <div>
          <svg viewBox={`0 0 ${W} ${H}`} className="av-svg" role="img" aria-label="Block diagram of launch vehicle avionics">
            <rect className="zone" x={620} y={360} width={210} height={100} rx={6} />
            <text className="zone-label" x={630} y={354}>
              Independent safety chain
            </text>
            {/* data bus */}
            <line x1={20} x2={820} y1={busY} y2={busY} className="wire-data" strokeWidth={4} />
            <text x={24} y={busY - 8} className="zone-label">
              Redundant data bus (A / B)
            </text>
            <line x1={cx(by('fc'))} x2={cx(by('fc'))} y1={92} y2={busY} className="wire-data" />
            {dataNodes.map((id) => (
              <line key={id} x1={cx(by(id))} x2={cx(by(id))} y1={busY} y2={210} className="wire-data" />
            ))}
            {lowerData.map((id) => (
              <path key={id} d={`M${cx(by(id)) + 30} ${busY} V${380}`} className="wire-data" />
            ))}
            {/* power: PDU to everything, drawn as a trunk on the left and a rail at y=345 */}
            <path d={`M${cx(by('pdu'))} 380 V345 H560`} className="wire-power" />
            {['gnss', 'ecu', 'tvc'].map((id) => (
              <path key={id} d={`M${cx(by(id)) - 30} 345 V262`} className="wire-power" />
            ))}
            <path d="M90 380 V262" className="wire-power" />
            <path d={`M${cx(by('pyro')) - 30} 345 V380`} className="wire-power" />
            <path d={`M${cx(by('tlm')) - 30} 345 V380`} className="wire-power" />
            <path d="M18 400 H30" className="wire-power" />
            <path d="M18 400 V20 H360 V40" className="wire-power" />
            {/* umbilical ground power */}
            <path d={`M640 66 H600 V20 H360`} className="wire-power" />
            {/* RF */}
            <path d="M570 405 h40 m-12 -14 l12 14 l-12 14" className="wire-rf" />
            <path d="M810 80 h16" className="wire-rf" />
            {NODES.map((n) => (
              <g
                key={n.id}
                className={'node' + (n.id === sel ? ' sel' : '')}
                transform={`translate(${n.x} ${n.y})`}
                tabIndex={0}
                role="button"
                aria-pressed={n.id === sel}
                aria-label={n.title}
                onClick={() => setSel(n.id)}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), setSel(n.id))}
              >
                <rect width={n.w ?? 120} height={n.id === 'fc' ? 52 : 52} rx={4} />
                <text x={10} y={22}>
                  {n.label}
                </text>
                <text x={10} y={39} className="sub">
                  {n.sub}
                </text>
              </g>
            ))}
          </svg>
          <div className="av-legend">
            <span>
              <i style={{ borderColor: '#1F5FA8' }} />
              Data
            </span>
            <span>
              <i style={{ borderColor: 'var(--kapton)', borderTopStyle: 'dashed' }} />
              Power
            </span>
            <span>
              <i style={{ borderColor: '#2E8A5C' }} />
              RF
            </span>
          </div>
        </div>
        <div className="av-arch-detail" aria-live="polite">
          <h3>{node.title}</h3>
          <p>{node.body}</p>
          <ul>
            {node.facts.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </div>
      </div>
      <Sources>
        <ul>
          <li>MIL-STD-1553B, Digital Time Division Command/Response Multiplex Data Bus (US DoD).</li>
          <li>CCSDS 133.0-B, Space Packet Protocol. IRIG 106, Telemetry Standards (Range Commanders Council).</li>
          <li>RCC 319, Flight Termination Systems Commonality Standard. 14 CFR Part 450 (FAA launch and reentry licensing).</li>
          <li>The diagram is a representative architecture, not any specific vehicle's. Real vehicles differ in redundancy and partitioning.</li>
        </ul>
      </Sources>
    </section>
  );
}
