/**
 * Procedural engine roar with Web Audio: brown noise (energy concentrated
 * low, like a real rocket's acoustic spectrum) through a low-pass whose
 * cutoff opens with thrust, plus a sub-bass rumble. Loudness follows thrust
 * and fades with air density: sound needs air to reach a microphone, so the
 * vacuum part of the flight is silent.
 */
export class EngineAudio {
  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private rumble: GainNode | null = null;
  private crackle: GainNode | null = null;

  start() {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    this.ctx = ctx;
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02; // integrate -> brown noise
      d[i] = last * 3.5;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 300;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter).connect(gain).connect(ctx.destination);

    // Crackle: white-noise bursts gated fast, the "tearing" sound close to a big engine
    const wbuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const w = wbuf.getChannelData(0);
    for (let i = 0; i < w.length; i++) w[i] = Math.random() < 0.002 ? Math.random() * 2 - 1 : 0;
    const wsrc = ctx.createBufferSource();
    wsrc.buffer = wbuf;
    wsrc.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1800;
    const crackle = ctx.createGain();
    crackle.gain.value = 0;
    wsrc.connect(bp).connect(crackle).connect(ctx.destination);

    const osc = ctx.createOscillator();
    osc.frequency.value = 38;
    const rumble = ctx.createGain();
    rumble.gain.value = 0;
    osc.connect(rumble).connect(ctx.destination);
    src.start();
    wsrc.start();
    osc.start();
    this.gain = gain;
    this.filter = filter;
    this.rumble = rumble;
    this.crackle = crackle;
  }

  /** thrustShare: thrust / liftoff thrust (0..~1.5); rho: air density [kg/m³] */
  set(thrustShare: number, rho: number) {
    if (!this.ctx || !this.gain || !this.filter || !this.rumble || !this.crackle) return;
    const air = Math.min(1, Math.sqrt(Math.max(rho, 0) / 1.225) * 1.6);
    const level = Math.min(1, thrustShare) * air;
    const now = this.ctx.currentTime;
    this.gain.gain.setTargetAtTime(0.55 * level, now, 0.12);
    this.rumble.gain.setTargetAtTime(0.35 * level, now, 0.15);
    this.crackle.gain.setTargetAtTime(0.5 * level * air, now, 0.1);
    this.filter.frequency.setTargetAtTime(180 + 900 * level, now, 0.2);
  }

  /** Short countdown tone with a soft attack/decay envelope. */
  beep(freq = 880, dur = 0.14, vol = 0.22) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'sine';
    o.frequency.value = freq;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.ctx.destination);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /** Launch-control voice via the browser's speech synthesiser (no audio files shipped). */
  static speak(text: string) {
    const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
    if (!synth) return;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.05;
    u.pitch = 0.85;
    u.volume = 1;
    const voice = synth.getVoices().find((v) => /en[-_](US|GB)/i.test(v.lang) && /male|david|daniel|alex|guy/i.test(v.name)) ?? synth.getVoices().find((v) => /^en/i.test(v.lang));
    if (voice) u.voice = voice;
    synth.speak(u);
  }

  stop() {
    if (!this.ctx) return;
    this.set(0, 0);
    void this.ctx.suspend();
  }

  dispose() {
    void this.ctx?.close();
    this.ctx = null;
  }
}
