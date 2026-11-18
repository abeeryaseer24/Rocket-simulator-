import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  AtmosphereWidget,
  DragWidget,
  GravityTurnWidget,
  HeatingWidget,
  LaunchSiteWidget,
  NozzleWidget,
  OrbitWidget,
  PropellantWidget,
  RocketEquationWidget,
  StagingWidget,
  TeX,
} from './widgets';

export interface Lesson {
  id: string;
  title: string;
  summary: string;
  discipline: string;
  body: () => ReactNode;
}

const Try = ({ to, children }: { to: string; children: ReactNode }) => (
  <p className="try">
    <strong>Try it:</strong> {children} <Link to={to}>Open it</Link>
  </p>
);

export const LESSONS: Lesson[] = [
  {
    id: 'rocket-equation',
    title: 'The rocket equation',
    discipline: 'Dynamics',
    summary: 'Why a rocket is mostly propellant, derived from conservation of momentum.',
    body: () => (
      <>
        <p>
          A rocket has nothing to push against. It moves forward by throwing mass backward. In a short time <TeX>dt</TeX> it
          ejects a mass <TeX>dm</TeX> at exhaust velocity <TeX>v_e</TeX> relative to itself. With no outside force, momentum
          before equals momentum after:
        </p>
        <TeX block>{'m\\,dv = -v_e\\,dm'}</TeX>
        <p>
          Divide by <TeX>m</TeX> and integrate from the initial mass <TeX>m_0</TeX> to the final mass <TeX>m_f</TeX>:
        </p>
        <TeX block>{'\\Delta v = v_e \\ln\\frac{m_0}{m_f} = I_{sp}\\, g_0 \\ln\\frac{m_0}{m_f}'}</TeX>
        <p>
          This is Tsiolkovsky’s equation (1903). Two things set how much velocity change <TeX>{'\\Delta v'}</TeX> you get: how
          fast the engine throws its exhaust, measured as specific impulse <TeX>{'I_{sp}'}</TeX> in seconds, and the mass ratio.
          The logarithm is the brutal part. Doubling Δv squares the required mass ratio.
        </p>
        <p>
          Reaching low Earth orbit takes about 7,800 m/s of horizontal speed plus 1,500–2,000 m/s lost to gravity, drag and
          steering, so roughly 9,400 m/s in total.
        </p>
        <RocketEquationWidget />
        <p>
          <TeX>{'g_0 = 9.80665\\ \\mathrm{m/s^2}'}</TeX> appears only because Isp is quoted in seconds by convention. It is a
          unit conversion and doesn't change with altitude or planet.
        </p>
        <Try to="/vehicle/stages">The Stages page computes this for every stage of your vehicle.</Try>
      </>
    ),
  },
  {
    id: 'staging',
    title: 'Staging',
    discipline: 'Systems engineering',
    summary: 'Throwing away empty tanks beats every other trick for reaching orbit.',
    body: () => (
      <>
        <p>
          A single-stage vehicle has to carry its empty tanks and its big first-stage engines all the way to orbit. Every
          kilogram of that dead weight sits in <TeX>m_f</TeX>, the denominator of the mass ratio. Staging splits the vehicle so
          that spent structure is dropped and never accelerated again.
        </p>
        <p>
          For a stage, the <em>structural ratio</em> is <TeX>{'\\varepsilon = m_{dry}/(m_{dry}+m_{prop})'}</TeX>. With
          payload ratio <TeX>{'\\lambda'}</TeX>, each stage’s mass ratio is
        </p>
        <TeX block>{'R = \\frac{1}{\\varepsilon + (1-\\varepsilon)\\lambda}, \\qquad \\Delta v_{total} = \\sum_k I_{sp,k}\\, g_0 \\ln R_k'}</TeX>
        <StagingWidget />
        <p>
          Real vehicles push this further: upper stages use high-Isp engines with large vacuum nozzles, and the first stage
          uses dense propellant and many engines for thrust. Each stage is optimized for where it flies.
        </p>
        <Try to="/vehicle/stages">Add a third stage to the medium-lift vehicle and watch the total Δv and the flight check.</Try>
      </>
    ),
  },
  {
    id: 'engines',
    title: 'Engines and nozzles',
    discipline: 'Thermodynamics and propulsion',
    summary: 'The thrust equation, nozzle expansion, and why sea-level Isp is lower.',
    body: () => (
      <>
        <p>
          In the combustion chamber, propellant burns at high pressure <TeX>p_c</TeX>. The converging–diverging (de Laval)
          nozzle accelerates the gas to Mach 1 at the throat and keeps accelerating it supersonically in the bell, turning
          thermal energy into directed kinetic energy. The thrust is
        </p>
        <TeX block>{'F = \\dot m\\, v_e + (p_e - p_a)\\,A_e'}</TeX>
        <p>
          The second term is a pressure imbalance across the nozzle exit. Exit pressure <TeX>p_e</TeX> is set by the area ratio{' '}
          <TeX>{'\\varepsilon = A_e/A_t'}</TeX> through the isentropic relations:
        </p>
        <TeX block>{'\\frac{A_e}{A_t} = \\frac{1}{M_e}\\left[\\frac{2}{\\gamma+1}\\left(1+\\frac{\\gamma-1}{2}M_e^2\\right)\\right]^{\\frac{\\gamma+1}{2(\\gamma-1)}}, \\qquad \\frac{p_e}{p_c} = \\left(1+\\frac{\\gamma-1}{2}M_e^2\\right)^{-\\frac{\\gamma}{\\gamma-1}}'}</TeX>
        <p>
          A big bell expands the gas to low <TeX>p_e</TeX>, which is ideal in vacuum. At sea level the surrounding air at{' '}
          <TeX>{'p_a = 101\\ \\mathrm{kPa}'}</TeX> pushes back on the whole exit area. That is why sea-level engines use short
          bells and vacuum engines use enormous ones. In this simulator mass flow is fixed by the chamber, so
        </p>
        <TeX block>{'F(p_a) = F_{vac} - p_a A_e, \\qquad I_{sp}(p_a) = \\frac{F(p_a)}{\\dot m\\, g_0}'}</TeX>
        <NozzleWidget />
        <p>
          The thrust coefficient <TeX>{'C_F = F/(p_c A_t)'}</TeX> measures how well the nozzle converts pressure into thrust.
          Real values are 1.6–2.0. The Engines page computes it, which makes it a useful check on whether your inputs are
          self-consistent.
        </p>
        <Try to="/vehicle/engines">Give the first stage the vacuum engine’s 8.5 m² exit area and see what sea-level thrust does.</Try>
      </>
    ),
  },
  {
    id: 'propellants',
    title: 'Propellants and tanks',
    discipline: 'Chemistry and structures',
    summary: 'Isp against density: why the best fuel on paper isn’t always the best choice.',
    body: () => (
      <>
        <p>
          Specific impulse rises with combustion temperature and falls with the molecular mass of the exhaust:{' '}
          <TeX>{'v_e \\propto \\sqrt{T_c / \\mathcal{M}}'}</TeX>. Hydrogen produces light water vapour and gets 420–450 s in
          vacuum. Kerosene gets about 310–350 s. Engines run <em>fuel-rich</em> of the stoichiometric ratio because the extra
          light molecules raise <TeX>v_e</TeX> more than the lost energy lowers it.
        </p>
        <p>
          Density pulls the other way. Tank mass scales roughly with tank volume, and hydrogen at 71 kg/m³ needs huge tanks.
          The mixture ratio <TeX>O/F</TeX> sets how the propellant splits between tanks:
        </p>
        <TeX block>{'V = \\frac{m}{1+O/F}\\cdot\\frac{1}{\\rho_{fuel}} + \\frac{m\\,(O/F)}{1+O/F}\\cdot\\frac{1}{\\rho_{ox}}'}</TeX>
        <PropellantWidget />
        <p>
          That’s why many first stages burn dense kerosene or methane: thrust and compact tanks matter most early in flight.
          Upper stages, where every kilogram is multiplied through the stages below, often use hydrogen.
        </p>
        <Try to="/vehicle/stages">Switch a stage’s propellant and watch whether the tanks still fit.</Try>
      </>
    ),
  },
  {
    id: 'atmosphere',
    title: 'The atmosphere',
    discipline: 'Fluid mechanics',
    summary: 'Hydrostatics and the ideal-gas law give the US Standard Atmosphere.',
    body: () => (
      <>
        <p>
          A slab of air of thickness <TeX>dh</TeX> is held up by the pressure difference across it. With the ideal gas law{' '}
          <TeX>{'p = \\rho R T'}</TeX>:
        </p>
        <TeX block>{'\\frac{dp}{dh} = -\\rho g_0 = -\\frac{p\\, g_0}{R T}'}</TeX>
        <p>
          The US Standard Atmosphere 1976 divides the air below 86 km into layers, each with a constant temperature lapse
          rate <TeX>L</TeX>. Integrating within a layer gives
        </p>
        <TeX block>{'L \\neq 0:\\ p = p_b\\left(\\frac{T_b}{T}\\right)^{g_0/(R L)} \\qquad L = 0:\\ p = p_b\\, e^{-g_0 (h-h_b)/(R T_b)}'}</TeX>
        <p>
          Here <TeX>h</TeX> is <em>geopotential</em> altitude, which corrects for gravity weakening with height. Above 86 km
          the gas separates by molecular weight, so the simulator uses the tabulated values instead.
        </p>
        <AtmosphereWidget />
        <p>
          The temperature profile matters for flight: in the cold tropopause the speed of sound drops to 295 m/s, so a
          vehicle goes supersonic at a lower true speed there than at sea level.
        </p>
        <Try to="/telemetry/atmosphere">See the density your vehicle actually flew through.</Try>
      </>
    ),
  },
  {
    id: 'drag',
    title: 'Drag, Mach and max-Q',
    discipline: 'Aerodynamics',
    summary: 'Dynamic pressure peaks early in every launch. Here is why, and what is done about it.',
    body: () => (
      <>
        <p>
          The force of the air on the vehicle scales with dynamic pressure, the kinetic energy per unit volume of the oncoming
          flow:
        </p>
        <TeX block>{'q = \\tfrac{1}{2}\\rho v^2, \\qquad D = q\\, C_D(M)\\, A_{ref}'}</TeX>
        <p>
          At liftoff <TeX>v</TeX> is small. High up, <TeX>{'\\rho'}</TeX> is tiny. In between, <TeX>q</TeX> passes through a
          maximum: <em>max-Q</em>, usually 25–35 kPa about a minute into flight. Structural loads, buffeting and the bending
          moment from any angle of attack all peak there, so many vehicles throttle down through a <em>throttle bucket</em>{' '}
          and back up once past it.
        </p>
        <p>
          The drag coefficient <TeX>C_D</TeX> rises sharply between Mach 0.8 and 1.2 as shock waves form on the vehicle, then
          falls slowly through the supersonic regime.
        </p>
        <DragWidget />
        <p>
          For a large rocket, drag loss is usually only 1–2 % of the Δv budget. It matters more for small rockets: drag
          scales with frontal area (<TeX>d^2</TeX>) but mass scales with volume (<TeX>d^3</TeX>), so small vehicles have
          more drag per kilogram.
        </p>
        <Try to="/telemetry/q">Read the dynamic-pressure trace and spot the throttle bucket.</Try>
      </>
    ),
  },
  {
    id: 'gravity-turn',
    title: 'The gravity turn and Δv losses',
    discipline: 'Flight mechanics',
    summary: 'Why rockets go up first and then sideways, and where the missing 1.5 km/s goes.',
    body: () => (
      <>
        <p>
          Orbit is about horizontal speed, but the vehicle has to climb out of the thick lower air first. The standard
          solution is the <em>gravity turn</em>: rise vertically to clear the tower, tip over by a few degrees (the pitch
          kick), then keep the thrust aligned with the velocity. Gravity bends the flight path over by itself, and with zero
          angle of attack the side loads stay small. The flight-path angle <TeX>{'\\gamma'}</TeX> evolves as
        </p>
        <TeX block>{'\\dot\\gamma = -\\frac{g\\cos\\gamma}{v}\\left(1 - \\frac{v^2}{g r}\\right)'}</TeX>
        <p>Projecting the equation of motion onto the velocity direction shows where the engines’ Δv goes:</p>
        <TeX block>{'\\Delta v_{ideal} = \\int \\frac{T}{m}dt = \\Delta v + \\underbrace{\\int g\\sin\\gamma\\, dt}_{\\text{gravity}} + \\underbrace{\\int \\frac{D}{m} dt}_{\\text{drag}} + \\underbrace{\\int \\frac{T}{m}(1-\\cos\\alpha)\\,dt}_{\\text{steering}}'}</TeX>
        <p>
          Gravity loss is the biggest term, typically 1,000–1,500 m/s. It's the price of hovering against gravity while the
          vehicle is still pointing upward, so high thrust-to-weight and an early turn reduce it. An early turn also means
          flying fast in thick air, which raises drag and loads. The pitch kick sets the balance.
        </p>
        <GravityTurnWidget />
        <Try to="/telemetry/budget">The Δv budget page shows every term integrated along your flight.</Try>
      </>
    ),
  },
  {
    id: 'orbits',
    title: 'Orbits',
    discipline: 'Orbital mechanics',
    summary: 'Vis-viva, circular speed and the six numbers that describe an orbit.',
    body: () => (
      <>
        <p>
          With only Earth's gravity acting, a vehicle follows a conic section. Energy conservation gives the vis-viva equation,
          which links speed <TeX>v</TeX> at radius <TeX>r</TeX> to the semi-major axis <TeX>a</TeX>:
        </p>
        <TeX block>{'v^2 = \\mu\\left(\\frac{2}{r} - \\frac{1}{a}\\right), \\qquad \\mu = GM_\\oplus = 3.986\\times10^{14}\\ \\mathrm{m^3/s^2}'}</TeX>
        <p>
          For a circle (<TeX>r = a</TeX>) this gives <TeX>{'v_c = \\sqrt{\\mu/r}'}</TeX>, about 7.7 km/s at 300 km. The
          period is <TeX>{'T = 2\\pi\\sqrt{a^3/\\mu}'}</TeX>, about 90 minutes in low orbit.
        </p>
        <p>
          The simulator turns the state vector into <em>osculating elements</em>: the orbit the vehicle would follow if the
          engines stopped now. Before cutoff the periapsis is deep inside Earth. It rises through the last minute of the
          upper-stage burn, and engine cutoff comes when the orbit’s energy reaches the target.
        </p>
        <OrbitWidget />
        <p>
          Earth isn’t a perfect sphere. The equatorial bulge, the <TeX>J_2</TeX> term, makes orbits precess and is included
          in the simulator’s gravity model:
        </p>
        <TeX block>{'\\mathbf{a} = -\\frac{\\mu\\mathbf{r}}{r^3}\\left[1 + \\tfrac{3}{2}J_2\\left(\\tfrac{R_e}{r}\\right)^2\\left(1 - 5\\tfrac{z^2}{r^2}\\right)\\right] + \\ldots'}</TeX>
        <Try to="/telemetry/orbit">Watch periapsis climb out of the ground during the upper-stage burn.</Try>
      </>
    ),
  },
  {
    id: 'launch-site',
    title: 'Launch site and azimuth',
    discipline: 'Orbital mechanics',
    summary: 'Earth’s rotation is free Δv, and your latitude limits which orbits you can reach.',
    body: () => (
      <>
        <p>
          A pad at latitude <TeX>{'\\phi'}</TeX> already moves east at <TeX>{'\\omega R\\cos\\phi'}</TeX>: 465 m/s at the
          equator, 408 m/s in Florida. Launch east and you keep it. Launch west (retrograde) and you pay it back twice.
        </p>
        <p>
          The orbit plane must pass through Earth’s centre and the launch site, so the lowest inclination you can reach
          directly equals your latitude. For a target inclination <TeX>i</TeX>, the inertial azimuth is
        </p>
        <TeX block>{'\\sin\\beta_i = \\frac{\\cos i}{\\cos\\phi}'}</TeX>
        <p>Because the pad is already moving, the vehicle should aim its velocity relative to the ground slightly differently:</p>
        <TeX block>{'\\tan\\beta_r = \\frac{v_c\\sin\\beta_i - \\omega R\\cos\\phi}{v_c\\cos\\beta_i}'}</TeX>
        <LaunchSiteWidget />
        <p>
          Even with the right azimuth, the Coriolis effect bends the path during flight. That’s why upper stages steer in yaw
          too. Without it, the simulator’s Florida launches miss a 51.6° target by about 6°.
        </p>
        <Try to="/vehicle/site">Move the medium-lift vehicle to Kourou and compare the propellant margin.</Try>
      </>
    ),
  },
  {
    id: 'loads',
    title: 'Loads and heating',
    discipline: 'Structures and heat transfer',
    summary: 'Axial g, bending from q·α, and the cube-of-speed law of aerodynamic heating.',
    body: () => (
      <>
        <p>
          <strong>Axial load.</strong> Acceleration along the axis is <TeX>{'(T - D)/m'}</TeX>. Thrust stays nearly constant
          while mass drops, so acceleration climbs through every burn. Payloads and crews are rated for limits, commonly 4–6
          g, so engines throttle back late in the burn.
        </p>
        <p>
          <strong>Bending.</strong> A slender vehicle at angle of attack <TeX>{'\\alpha'}</TeX> feels a side force that grows
          with <TeX>{'q\\alpha'}</TeX>. Structural margins are usually set against a maximum <TeX>{'q\\alpha'}</TeX>, often a
          few hundred kPa·degrees. Winds aloft drive it in reality. In this simulator the gravity turn holds α near zero
          during the high-q phase.
        </p>
        <p>
          <strong>Heating.</strong> At the nose, convective heat flux at the stagnation point is estimated by Sutton–Graves:
        </p>
        <TeX block>{'\\dot q = k\\sqrt{\\frac{\\rho}{r_n}}\\, v^3, \\qquad k = 1.7415\\times10^{-4}\\ \\mathrm{SI}'}</TeX>
        <HeatingWidget />
        <p>
          Heating peaks later than max-Q because it grows with <TeX>v^3</TeX> rather than <TeX>v^2</TeX>. The fairing is
          dropped once free-molecular heating on the payload falls below about 1.1 kW/m².
        </p>
        <Try to="/telemetry/heating">Compare the heating peak with the max-Q time.</Try>
      </>
    ),
  },
  {
    id: 'guidance',
    title: 'Guidance',
    discipline: 'Control engineering',
    summary: 'Open loop down low, closed loop up high: how the upper stage hits its orbit.',
    body: () => (
      <>
        <p>
          The first stage flies <em>open loop</em>: a pre-planned vertical rise, pitch kick and gravity turn. In thick air the
          priority is keeping the angle of attack small, not optimizing the path.
        </p>
        <p>
          The upper stage flies <em>closed loop</em>, recomputing its steering every step from where it is now. The simulator
          uses the core idea of the linear-tangent / PEG family. It picks a vertical acceleration that varies linearly in
          time and drives both the altitude error <TeX>{'\\Delta h'}</TeX> and the vertical speed <TeX>{'\\dot r'}</TeX> to
          zero at burnout, <TeX>{'t_{go}'}</TeX> seconds from now. Solving the two boundary conditions gives the command at
          this instant:
        </p>
        <TeX block>{'a_r = \\frac{6\\,\\Delta h}{t_{go}^2} - \\frac{4\\,\\dot r}{t_{go}}'}</TeX>
        <p>Thrust has to supply that plus gravity, minus the centrifugal relief from horizontal speed:</p>
        <TeX block>{'\\sin\\theta = \\frac{a_r + g - v_h^2/r}{T/m}'}</TeX>
        <p>
          Time to go comes from the rocket equation for the velocity still to be gained, and the horizontal thrust points
          along the horizontal part of that velocity-to-be-gained vector. That steers speed and orbit plane at the same time.
          Cutoff happens when the orbit’s energy reaches the target.
        </p>
        <Try to="/telemetry/angles">Compare thrust pitch with flight-path angle: they match in the gravity turn and separate under closed-loop steering.</Try>
      </>
    ),
  },
];
