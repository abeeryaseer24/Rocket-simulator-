import * as THREE from 'three';
import { DEG, FLATTENING, OMEGA_EARTH, P0, R_EQ } from '../physics/constants';
import { geodeticToECEF, localFrame } from '../physics/earth';
import { orbitPolyline } from '../physics/orbit';
import type { PropellantKind } from '../physics/propulsion';
import { rotZ, unit, type Vec3 } from '../physics/vec';
import type { FlightResult, Sample } from '../sim/simulate';
import type { StageSpec, Vehicle } from '../sim/vehicle';
import { ATMO_FRAG, ATMO_VERT, EARTH_FRAG, EARTH_VERT, PLUME_FRAG, PLUME_VERT } from './shaders';

export type CameraMode = 'chase' | 'tracking' | 'orbital';

const KM = 1e-3;
const RE_KM = R_EQ * KM;

const PLUME_COLORS: Record<PropellantKind, [string, string, number]> = {
  'RP-1 / LOX': ['#fff4dc', '#ff7a1c', 1.0],
  'LH2 / LOX': ['#eaf2ff', '#6f9cff', 0.45],
  'CH4 / LOX': ['#eef2ff', '#5a78ff', 0.7],
  'Solid (HTPB/AP)': ['#fffaf0', '#ffb04a', 1.15],
  'Hypergolic (MMH/NTO)': ['#fff0dc', '#ff9a5a', 0.8],
};

/**
 * Sky colour from local air density. Rayleigh scattering scales with the
 * number of molecules along the line of sight, so log-density is a good
 * single knob: blue at sea level, indigo by 30 km, black above ~80 km.
 */
export function skyColor(rho: number): THREE.Color {
  const b = Math.max(0, Math.min(1, 1 + Math.log10(Math.max(rho, 1e-12) / 1.225) / 5));
  const stops: Array<[number, string]> = [
    [0, '#000000'],
    [0.18, '#050d24'],
    [0.5, '#1d4a8f'],
    [0.8, '#5d93d1'],
    [1, '#9cc4ea'],
  ];
  for (let i = 1; i < stops.length; i++) {
    if (b <= stops[i][0]) {
      const f = (b - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0]);
      return new THREE.Color(stops[i - 1][1]).lerp(new THREE.Color(stops[i][1]), f);
    }
  }
  return new THREE.Color(stops[stops.length - 1][1]);
}

interface Debris {
  obj: THREE.Object3D;
  t0: number;
  offset: THREE.Vector3;
  dir: THREE.Vector3;
  side: THREE.Vector3;
  spin: THREE.Vector3;
  accel: number;
}

const toV = (a: Vec3, s = 1) => new THREE.Vector3(a[0] * s, a[1] * s, a[2] * s);

export class FlightScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  private earth = new THREE.Group();
  private rocket = new THREE.Group();
  private stageGroups: THREE.Group[] = [];
  private boosterGroup: THREE.Group | null = null;
  private fairingGroup: THREE.Group | null = null;
  private plumes: Array<{ mesh: THREE.Mesh; owner: 'core' | 'booster'; stage: number; d: number }> = [];
  private plumeMats: THREE.ShaderMaterial[] = [];
  private stars: THREE.Points;
  private trail: THREE.Line;
  private trailGeo = new THREE.BufferGeometry();
  private orbitLine: THREE.Line | null = null;
  private marker: THREE.Mesh;
  private earthMat: THREE.ShaderMaterial;
  private atmoMat: THREE.ShaderMaterial;
  private sun: THREE.DirectionalLight;
  private sunDir: THREE.Vector3;
  private debris: Debris[] = [];
  private stageOffsets: number[] = [];
  private stackH = 50;
  private last = { stage: 0, boosters: true, fairing: true };
  private vehicle: Vehicle;
  private result: FlightResult | null = null;
  private site: Vec3;
  /** Chase camera spherical offset in the local frame */
  orbitCam = { yaw: 0.9, pitch: 0.18, dist: 0 };
  mode: CameraMode = 'chase';

  constructor(private canvas: HTMLCanvasElement, vehicle: Vehicle) {
    this.vehicle = vehicle;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.0004, 4e5);

    this.site = geodeticToECEF(vehicle.site.lat * DEG, vehicle.site.lon * DEG, vehicle.site.elevation);
    const siteDir = unit(this.site);
    this.sunDir = toV(unit([siteDir[0] * 0.6 + siteDir[1] * 0.75, siteDir[1] * 0.6 - siteDir[0] * 0.75, siteDir[2] * 0.6 + 0.25]));

    // ---- Earth ----
    const geo = new THREE.SphereGeometry(1, 512, 256);
    geo.rotateX(Math.PI / 2);
    const lowered = RE_KM - 0.35;
    geo.scale(lowered, lowered, lowered * (1 - FLATTENING));
    this.earthMat = new THREE.ShaderMaterial({
      vertexShader: EARTH_VERT,
      fragmentShader: EARTH_FRAG,
      uniforms: { uSun: { value: this.sunDir }, uSite: { value: toV(siteDir) } },
    });
    this.earth.add(new THREE.Mesh(geo, this.earthMat));
    this.earth.add(new THREE.Mesh(this.buildCap(vehicle), this.earthMat));
    this.earth.add(this.buildPad(vehicle));
    const atmoGeo = new THREE.SphereGeometry(RE_KM + 90, 128, 64);
    atmoGeo.rotateX(Math.PI / 2);
    this.atmoMat = new THREE.ShaderMaterial({
      vertexShader: ATMO_VERT,
      fragmentShader: ATMO_FRAG,
      uniforms: { uSun: { value: this.sunDir } },
      side: THREE.BackSide,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.earth.add(new THREE.Mesh(atmoGeo, this.atmoMat));
    this.scene.add(this.earth);

    // ---- lights ----
    this.sun = new THREE.DirectionalLight(0xffffff, 2.6);
    this.scene.add(this.sun);
    this.scene.add(new THREE.HemisphereLight(0xbcd3ee, 0x3a3328, 0.55));

    // ---- stars (re-centred on the camera every frame, i.e. at infinity) ----
    const sp = new Float32Array(4500 * 3);
    for (let i = 0; i < 4500; i++) {
      const u = Math.random() * 2 - 1;
      const th = Math.random() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      sp.set([s * Math.cos(th) * 1e5, s * Math.sin(th) * 1e5, u * 1e5], i * 3);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    this.stars = new THREE.Points(
      sg,
      new THREE.PointsMaterial({ color: 0xffffff, size: 1.3, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false }),
    );
    this.scene.add(this.stars);

    // ---- trajectory trail ----
    this.trail = new THREE.Line(this.trailGeo, new THREE.LineBasicMaterial({ color: 0xe0a83a, transparent: true, opacity: 0.9 }));
    this.trail.frustumCulled = false;
    this.scene.add(this.trail);

    // ---- far-view marker ----
    this.marker = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 8), new THREE.MeshBasicMaterial({ color: 0xffc35a }));
    this.scene.add(this.marker);

    this.buildRocket(vehicle);
    this.scene.add(this.rocket);
    this.orbitCam.dist = this.stackH * 2.4 * KM;
    this.resize();
  }

  /** High-resolution spherical cap around the pad so the ground under the vehicle is exact. */
  private buildCap(v: Vehicle): THREE.BufferGeometry {
    const rings = 140;
    const segs = 160;
    const maxAng = 4 * DEG;
    const lat0 = v.site.lat * DEG;
    const lon0 = v.site.lon * DEG;
    const pos: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i <= rings; i++) {
      const a = maxAng * Math.pow(i / rings, 2);
      for (let j = 0; j <= segs; j++) {
        const brg = (j / segs) * Math.PI * 2;
        const lat = Math.asin(Math.sin(lat0) * Math.cos(a) + Math.cos(lat0) * Math.sin(a) * Math.cos(brg));
        const lon = lon0 + Math.atan2(Math.sin(brg) * Math.sin(a) * Math.cos(lat0), Math.cos(a) - Math.sin(lat0) * Math.sin(lat));
        const p = geodeticToECEF(lat, lon, 0);
        pos.push(p[0] * KM, p[1] * KM, p[2] * KM);
      }
    }
    for (let i = 0; i < rings; i++)
      for (let j = 0; j < segs; j++) {
        const a = i * (segs + 1) + j;
        const b = a + segs + 1;
        idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    return g;
  }

  private buildPad(v: Vehicle): THREE.Group {
    const g = new THREE.Group();
    const H = v.stages.reduce((a, s) => a + s.length, 0) + v.fairing.length;
    const concrete = new THREE.MeshStandardMaterial({ color: 0x8d9090, roughness: 0.95 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x3b4148, roughness: 0.6, metalness: 0.4 });
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(90, 90, 2, 48), concrete);
    pad.position.y = -0.9;
    g.add(pad);
    const towerH = H * 1.08 + 8;
    const tw = 7;
    const off = Math.max(v.stages[0].diameter, v.boosters.count ? v.boosters.stage.diameter * 3 : 0) / 2 + tw / 2 + 4;
    for (const [dx, dz] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.5, towerH, 0.5), steel);
      leg.position.set(off + (dx * tw) / 2, towerH / 2, (dz * tw) / 2);
      g.add(leg);
    }
    for (let y = 6; y < towerH; y += 6) {
      const ring = new THREE.Mesh(new THREE.BoxGeometry(tw, 0.35, tw), steel);
      ring.position.set(off, y, 0);
      g.add(ring);
    }
    const arm = new THREE.Mesh(new THREE.BoxGeometry(off - 1, 1.2, 1.6), steel);
    arm.position.set(off / 2, H * 0.85, 0);
    g.add(arm);
    // Orient the pad on the geodetic normal at the site, in km
    g.scale.setScalar(KM);
    const { up } = localFrame(this.site);
    const lat = v.site.lat * DEG;
    const lon = v.site.lon * DEG;
    const n = new THREE.Vector3(Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat));
    g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
    void up;
    g.position.copy(toV(this.site, KM));
    return g;
  }

  private buildStage(s: StageSpec, isTop: boolean): THREE.Group {
    const g = new THREE.Group();
    const body = new THREE.MeshStandardMaterial({ color: 0xe8ecef, roughness: 0.45, metalness: 0.05 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1e232a, roughness: 0.6 });
    const bellMat = new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.35, metalness: 0.8, side: THREE.DoubleSide });
    const cyl = new THREE.Mesh(new THREE.CylinderGeometry(s.diameter / 2, s.diameter / 2, s.length, 48), body);
    cyl.position.y = s.length / 2;
    g.add(cyl);
    if (!isTop) {
      const band = Math.min(s.diameter * 0.55, s.length * 0.1);
      const is = new THREE.Mesh(new THREE.CylinderGeometry(s.diameter / 2 + 0.01, s.diameter / 2 + 0.01, band, 48), dark);
      is.position.y = s.length - band / 2;
      g.add(is);
    }
    const n = s.engine.count;
    const re = Math.max(Math.sqrt(s.engine.exitArea / Math.PI), 0.15);
    const bellLen = Math.min(re * 2.6, s.diameter * 0.9);
    const ring = n > 1 ? s.diameter / 2 - re * 1.05 : 0;
    for (let i = 0; i < n; i++) {
      const center = n > 1 && i === n - 1 && n % 2 === 1 && n >= 5;
      const ang = (i / (center ? n - 1 : n)) * Math.PI * 2;
      const rr = center ? 0 : Math.max(ring, 0);
      const bell = new THREE.Mesh(new THREE.CylinderGeometry(re * 0.35, re, bellLen, 24, 1, true), bellMat);
      bell.position.set(Math.cos(ang) * rr, -bellLen / 2, Math.sin(ang) * rr);
      g.add(bell);
    }
    g.userData.bellLen = bellLen;
    return g;
  }

  private buildRocket(v: Vehicle) {
    this.rocket.clear();
    this.stageGroups = [];
    this.plumes = [];
    this.plumeMats = [];
    const inner = new THREE.Group();
    let y = this.buildStage(v.stages[0], false).userData.bellLen as number;
    const base = y;
    this.stageOffsets = [];
    v.stages.forEach((s, i) => {
      const sg = this.buildStage(s, i === v.stages.length - 1);
      sg.position.y = y;
      this.stageOffsets.push(y);
      inner.add(sg);
      this.stageGroups.push(sg);
      this.addPlume(sg, s, 'core', i);
      y += s.length;
    });
    // Fairing as two half-shells so it can split on jettison
    const f = v.fairing;
    const fd = Math.max(f.diameter, v.stages[v.stages.length - 1].diameter);
    const fg = new THREE.Group();
    const fmat = new THREE.MeshStandardMaterial({ color: 0xf2f4f5, roughness: 0.4, side: THREE.DoubleSide });
    const cylLen = f.length * 0.58;
    const pts: THREE.Vector2[] = [];
    for (let i = 0; i <= 24; i++) {
      const tt = i / 24;
      pts.push(new THREE.Vector2((fd / 2) * Math.sqrt(1 - tt * tt) + 0.001, cylLen + tt * (f.length - cylLen)));
    }
    pts.unshift(new THREE.Vector2(fd / 2, 0));
    for (const half of [0, 1]) {
      const shell = new THREE.Mesh(new THREE.LatheGeometry(pts, 24, half * Math.PI, Math.PI), fmat);
      shell.userData.half = half;
      fg.add(shell);
    }
    fg.position.y = y;
    inner.add(fg);
    this.fairingGroup = fg;
    y += f.length;
    this.stackH = y;

    if (v.boosters.count > 0) {
      const bg = new THREE.Group();
      const b = v.boosters.stage;
      const r = v.stages[0].diameter / 2 + b.diameter / 2 + 0.15;
      for (let i = 0; i < v.boosters.count; i++) {
        const ang = (i / v.boosters.count) * Math.PI * 2;
        const one = this.buildStage(b, true);
        const nose = new THREE.Mesh(
          new THREE.ConeGeometry(b.diameter / 2, b.diameter * 1.6, 32),
          new THREE.MeshStandardMaterial({ color: 0xe8ecef, roughness: 0.45 }),
        );
        nose.position.y = b.length + b.diameter * 0.8;
        one.add(nose);
        one.position.set(Math.cos(ang) * r, base, Math.sin(ang) * r);
        this.addPlume(one, b, 'booster', -1);
        bg.add(one);
      }
      inner.add(bg);
      this.boosterGroup = bg;
    } else this.boosterGroup = null;
    inner.scale.setScalar(KM);
    this.rocket.add(inner);
  }

  private addPlume(parent: THREE.Group, s: StageSpec, owner: 'core' | 'booster', stage: number) {
    const [core, edge, alpha] = PLUME_COLORS[s.propellant];
    const mat = new THREE.ShaderMaterial({
      vertexShader: PLUME_VERT,
      fragmentShader: PLUME_FRAG,
      uniforms: {
        uCore: { value: new THREE.Color(core) },
        uEdge: { value: new THREE.Color(edge) },
        uTime: { value: 0 },
        uAlpha: { value: alpha },
        uDiamonds: { value: 1 },
      },
      transparent: true,
      blending: THREE.NormalBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    mat.userData.baseAlpha = alpha;
    const geo = new THREE.ConeGeometry(1, 1, 32, 1, true);
    geo.translate(0, 0.5, 0);
    geo.rotateX(Math.PI); // base (uv.y = 0) at the nozzle, apex trailing downstream
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = -(parent.userData.bellLen as number);
    mesh.visible = false;
    parent.add(mesh);
    this.plumes.push({ mesh, owner, stage, d: s.diameter });
    this.plumeMats.push(mat);
  }

  setResult(r: FlightResult | null) {
    this.result = r;
    this.debris.forEach((d) => this.scene.remove(d.obj));
    this.debris = [];
    this.last = { stage: 0, boosters: true, fairing: true };
    this.stageGroups.forEach((g) => (g.visible = true));
    if (this.boosterGroup) this.boosterGroup.visible = true;
    if (this.fairingGroup) this.fairingGroup.visible = true;
    if (this.orbitLine) {
      this.scene.remove(this.orbitLine);
      this.orbitLine = null;
    }
    if (r) {
      const pos = new Float32Array(r.samples.length * 3);
      r.samples.forEach((s, i) => pos.set([s.pos[0] * KM, s.pos[1] * KM, s.pos[2] * KM], i * 3));
      this.trailGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      this.trailGeo.setDrawRange(0, 0);
      if (r.cutoffState && r.final && r.final.peri > 0) {
        const pts = orbitPolyline(r.cutoffState.r, r.cutoffState.v, 360).map((p) => toV(p, KM));
        const og = new THREE.BufferGeometry().setFromPoints(pts);
        this.orbitLine = new THREE.Line(og, new THREE.LineDashedMaterial({ color: 0xdfe8ee, dashSize: 120, gapSize: 80, transparent: true, opacity: 0 }));
        this.orbitLine.computeLineDistances();
        this.orbitLine.frustumCulled = false;
        this.scene.add(this.orbitLine);
      }
    }
  }

  private spawnDebris(obj: THREE.Object3D, s: Sample, sideways = 0) {
    const clone = obj.clone(true);
    clone.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && (o as THREE.Mesh).material instanceof THREE.ShaderMaterial) o.visible = false;
    });
    const wp = new THREE.Vector3();
    obj.getWorldPosition(wp);
    const wq = new THREE.Quaternion();
    obj.getWorldQuaternion(wq);
    clone.position.copy(wp);
    clone.quaternion.copy(wq);
    clone.scale.setScalar(KM);
    this.scene.add(clone);
    const dir = toV(s.dir);
    const side = new THREE.Vector3().randomDirection().projectOnPlane(dir).normalize().multiplyScalar(sideways);
    this.debris.push({
      obj: clone,
      t0: s.t,
      offset: wp.clone(),
      dir,
      side,
      spin: new THREE.Vector3((Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.2, (Math.random() - 0.5) * 0.4),
      accel: Math.max(s.thrust / s.mass, 5),
    });
  }

  /** Advance visuals to sample s (interpolated) at mission time t. */
  update(s: Sample, t: number, wallTime: number) {
    const rocketPos = toV(s.pos, KM);
    const theta = OMEGA_EARTH * Math.max(t, 0);
    this.earth.position.copy(rocketPos).multiplyScalar(-1);
    this.earth.rotation.set(0, 0, theta);
    const dir = toV(s.dir);
    this.rocket.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);

    // ---- staging visuals ----
    if (this.result) {
      if (s.stage > this.last.stage) {
        for (let i = this.last.stage; i < s.stage; i++) {
          this.spawnDebris(this.stageGroups[i], s);
          this.stageGroups[i].visible = false;
        }
      }
      if (s.stage < this.last.stage) this.stageGroups.forEach((g, i) => (g.visible = i >= s.stage));
      if (this.boosterGroup) {
        if (this.last.boosters && !s.boosters) {
          this.boosterGroup.children.forEach((c) => this.spawnDebris(c, s, 3));
        }
        this.boosterGroup.visible = s.boosters;
      }
      if (this.fairingGroup) {
        if (this.last.fairing && !s.fairing) this.fairingGroup.children.forEach((c) => this.spawnDebris(c, s, 6));
        this.fairingGroup.visible = s.fairing;
      }
      this.last = { stage: s.stage, boosters: s.boosters, fairing: s.fairing };
    }
    this.debris = this.debris.filter((d) => {
      const dt = t - d.t0;
      if (dt > 40 || dt < 0) {
        this.scene.remove(d.obj);
        return false;
      }
      // Relative to the still-thrusting vehicle, jettisoned hardware falls back at ~a·t²/2
      const back = 0.5 * d.accel * dt * dt * KM;
      const p = d.offset.clone().addScaledVector(d.dir, -back).addScaledVector(d.side, dt * KM);
      d.obj.position.copy(p);
      d.obj.rotateX(d.spin.x * 0.016);
      d.obj.rotateZ(d.spin.z * 0.016);
      return true;
    });

    // ---- plumes: expand as ambient pressure falls (under-expanded jet) ----
    const pRatio = Math.max(0, Math.min(1, s.pressure / P0));
    const expand = 1 - pRatio;
    for (const p of this.plumes) {
      const on = s.burning && (p.owner === 'booster' ? s.boosters : p.stage === s.stage && s.throttle > 0);
      p.mesh.visible = on;
      if (!on) continue;
      const thr = p.owner === 'booster' ? 1 : Math.max(s.throttle, 0.3);
      const rad = (p.d / 2) * (0.7 + 3.4 * expand * expand);
      const len = p.d * (4.5 + 7 * expand) * (0.6 + 0.4 * thr);
      p.mesh.scale.set(rad, len, rad);
      const m = p.mesh.material as THREE.ShaderMaterial;
      m.uniforms.uTime.value = wallTime;
      m.uniforms.uDiamonds.value = pRatio > 0.02 ? 1 : 0;
      // A vacuum plume is a thin, wide, mostly transparent fan, not a flame
      m.uniforms.uAlpha.value = (m.userData.baseAlpha as number) * (1 - 0.72 * expand);
    }
    if (t < 0 && t > -2.5) {
      // engine start transient during the final seconds of the count
      for (const p of this.plumes) {
        if (p.owner === 'core' && p.stage !== 0) continue;
        p.mesh.visible = true;
        const f = (t + 2.5) / 2.5;
        p.mesh.scale.set(p.d * 0.25 * f, p.d * 1.2 * f, p.d * 0.25 * f);
        (p.mesh.material as THREE.ShaderMaterial).uniforms.uTime.value = wallTime;
      }
    }

    // ---- trail and orbit ----
    if (this.result) {
      const n = this.result.samples.findIndex((x) => x.t > t);
      this.trailGeo.setDrawRange(0, n < 0 ? this.result.samples.length : n);
      this.trail.position.copy(rocketPos).multiplyScalar(-1);
      if (this.orbitLine) {
        this.orbitLine.position.copy(rocketPos).multiplyScalar(-1);
        const cutoffT = this.result.cutoffState?.t ?? Infinity;
        (this.orbitLine.material as THREE.LineDashedMaterial).opacity = t > cutoffT ? Math.min(0.8, (t - cutoffT) / 10) : 0;
      }
    }

    // ---- sky, stars, sun ----
    const sky = this.mode === 'orbital' ? new THREE.Color(0) : skyColor(s.rho);
    this.scene.background = sky;
    const dark = this.mode === 'orbital' ? 1 : Math.max(0, 1 - sky.getHSL({ h: 0, s: 0, l: 0 }).l * 4);
    (this.stars.material as THREE.PointsMaterial).opacity = dark;
    this.sun.position.copy(this.sunDir).multiplyScalar(10);
    this.sun.target.position.set(0, 0, 0);

    // ---- camera ----
    const { up, east, north } = localFrame(s.pos);
    const U = toV(up);
    const E = toV(east);
    const N = toV(north);
    const center = dir.clone().multiplyScalar(this.visibleCenter(s) * KM);
    this.marker.visible = false;
    if (this.mode === 'chase') {
      const { yaw, pitch, dist } = this.orbitCam;
      const off = E.clone()
        .multiplyScalar(Math.cos(pitch) * Math.cos(yaw))
        .addScaledVector(N, Math.cos(pitch) * Math.sin(yaw))
        .addScaledVector(U, Math.sin(pitch))
        .multiplyScalar(dist);
      this.camera.position.copy(center).add(off);
      this.camera.up.copy(U);
      this.camera.fov = 45;
      this.camera.lookAt(center);
    } else if (this.mode === 'tracking') {
      // Long-lens tracking camera on the ground 3 km from the pad
      const site = toV(this.site, KM);
      const lf = localFrame(this.site);
      const camEcef = site
        .clone()
        .addScaledVector(toV(lf.east), -2.2)
        .addScaledVector(toV(lf.north), -2.0)
        .addScaledVector(toV(lf.up), 0.02);
      const camWorld = camEcef.applyAxisAngle(new THREE.Vector3(0, 0, 1), theta).sub(rocketPos);
      this.camera.position.copy(camWorld);
      this.camera.up.copy(toV(rotZ(lf.up, theta)));
      this.camera.lookAt(center);
      const dist = camWorld.distanceTo(center);
      const want = (2 * Math.atan((this.stackH * KM * 3.2) / dist) * 180) / Math.PI;
      this.camera.fov = Math.max(0.25, Math.min(50, want));
      this.marker.visible = dist > 300;
      this.marker.scale.setScalar(dist * 0.004);
    } else {
      const earthC = rocketPos.clone().multiplyScalar(-1);
      const { yaw, pitch } = this.orbitCam;
      const base = rocketPos.clone().normalize();
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), yaw - 0.9);
      const v = base.applyQuaternion(q);
      v.z += pitch;
      v.normalize();
      const d = RE_KM * 3.4;
      this.camera.position.copy(earthC).addScaledVector(v, d);
      this.camera.up.set(0, 0, 1);
      this.camera.fov = 40;
      this.camera.lookAt(earthC);
      this.marker.visible = true;
      this.marker.scale.setScalar(60);
    }
    this.camera.updateProjectionMatrix();
    this.stars.position.copy(this.camera.position);
    this.renderer.render(this.scene, this.camera);
  }

  /** Height of the middle of what is still attached, along the vehicle axis [m]. */
  private visibleCenter(s: Sample): number {
    const lo = this.stageOffsets[Math.min(s.stage, this.stageOffsets.length - 1)] ?? 0;
    const hi = s.fairing ? this.stackH : this.stackH - this.vehicle.fairing.length;
    return (lo + hi) / 2;
  }

  resize() {
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    this.renderer.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
  }

  stackHeightKm() {
    return this.stackH * KM;
  }
}
