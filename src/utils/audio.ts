// High-fidelity procedurally synthesized sound effects for RTS.
// Bypasses static asset loading and guarantees reliable audio responses.

class RTSAudioEngine {
  private ctx: AudioContext | null = null;
  private enabled = true;

  // Master bus — every SFX and the BGM route through this so positional
  // sounds, muting and future volume control all share one output.
  private master: GainNode | null = null;

  // Listener = centre of the player's current view (camera target).
  // Updated every frame from the game loop via setListener().
  private listenerX = 0;
  private listenerZ = 0;
  private listenerRot = 0;     // camera yaw, so stereo pan follows the screen
  private viewRadius = 30;     // world units roughly covering the visible area

  // While set, freshly-built SFX route here (a per-call spatial node) instead
  // of straight to the master bus. Safe because each play* method builds its
  // graph synchronously before this is cleared.
  private routeOverride: AudioNode | null = null;

  /** Output node any SFX should connect to. */
  private out(): AudioNode {
    return this.routeOverride ?? this.master ?? this.ctx!.destination;
  }

  /** Update the audio listener to the centre of the player's view. */
  setListener(x: number, z: number, viewRadius: number, rotation: number) {
    this.listenerX = x;
    this.listenerZ = z;
    this.viewRadius = viewRadius > 1 ? viewRadius : 30;
    this.listenerRot = rotation;
  }

  /**
   * Build the per-call spatial chain (distance gain + stereo pan) for a world
   * position, or return null if it would be inaudible (so we can skip
   * synthesising far-off-screen sounds entirely — a real perf win).
   *
   * Falloff: full inside the view, only slightly quieter toward the edge,
   * then a short tail just beyond the view that drops to silence fast.
   */
  private spatialInput(x: number, z: number): GainNode | null {
    const ctx = this.ctx!;
    if (!this.master) return null;
    const dx = x - this.listenerX;
    const dz = z - this.listenerZ;
    const dist = Math.hypot(dx, dz);
    const r = this.viewRadius;

    let g: number;
    if (dist <= r) {
      g = 1 - 0.4 * (dist / r);                      // 1.0 centre → 0.6 at view edge
    } else {
      g = 0.6 * Math.max(0, 1 - (dist - r) / (r * 0.5)); // edge → 0 by 1.5×radius
    }
    if (g < 0.02) return null;                       // inaudible, skip entirely

    const gain = ctx.createGain();
    gain.gain.value = g;
    const panner = ctx.createStereoPanner();
    // Pan by the screen-right component of the offset (camera-rotation aware).
    const cos = Math.cos(this.listenerRot);
    const sin = Math.sin(this.listenerRot);
    panner.pan.value = Math.max(-1, Math.min(1, (dx * cos - dz * sin) / r));
    gain.connect(panner).connect(this.master);
    return gain;
  }

  /**
   * Play one of the SFX methods anchored to a world position.
   * Usage: sound.playSpatial('playExplosion', x, z)
   */
  playSpatial(method: 'playExplosion' | 'playGunshot' | 'playLaser' | 'playAllianceZap' | 'playCoalitionBoom' | 'playUnionTesla' | 'playSyndicateAcid' | 'playConstruction' | 'playLaunch', x: number, z: number) {
    if (!this.enabled) return;
    this.initCtx();
    if (!this.ctx) return;
    const node = this.spatialInput(x, z);
    if (!node) return;            // inaudible → don't even synthesise
    this.routeOverride = node;
    try {
      (this[method] as () => void)();
    } finally {
      this.routeOverride = null;
    }
  }

  private bgmGain: GainNode | null = null;
  private bgmOscillators: OscillatorNode[] = [];
  
  private bgmTimer: number | null = null;
  private nextBgmNoteTime = 0;
  private bgmStep = 0;
  private bgmArpPattern: number[] = [];
  private bgmBassPattern: number[] = [];
  private noiseBuffer: AudioBuffer | null = null;

  private getNoiseBuffer(ctx: AudioContext) {
      if (!this.noiseBuffer) {
          const size = ctx.sampleRate * 0.5;
          const buffer = ctx.createBuffer(1, size, ctx.sampleRate);
          const data = buffer.getChannelData(0);
          for(let i=0; i<size; i++) data[i] = Math.random() * 2 - 1;
          this.noiseBuffer = buffer;
      }
      return this.noiseBuffer;
  }

  private initCtx() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (!this.master) {
      // Master bus: all SFX route here (directly, or via a per-call spatial
      // node) so the whole mix shares one output and can be scaled later.
      this.master = this.ctx.createGain();
      this.master.gain.value = 1.0;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  toggle(on: boolean) {
    this.enabled = on;
    if (!on) {
      this.stopBGM();
    } else if (this.ctx && this.ctx.state === 'running') {
      this.startBGM();
    }
  }

  startBGM() {
    if (!this.enabled || this.bgmGain) return;
    this.initCtx();
    const ctx = this.ctx!;
    if (ctx.state !== 'running') return; // Must have user interaction first
    
    this.bgmGain = ctx.createGain();
    this.bgmGain.gain.value = 0.5; // Main bus volume
    this.bgmGain.connect(this.out());
    
    // Atmospheric dark drone (persistent background pad)
    const drone = ctx.createOscillator();
    drone.type = "sawtooth";
    drone.frequency.value = 36.71; // D1
    
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 250;
    filter.Q.value = 2;
    
    const lfo = ctx.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = 0.04; // Very slow LFO
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 180;
    lfo.connect(lfoGain).connect(filter.frequency);
    
    const padGain = ctx.createGain();
    padGain.gain.value = 0.12; // Pad volume
    
    drone.connect(filter).connect(padGain).connect(this.bgmGain);
    drone.start();
    lfo.start();
    this.bgmOscillators.push(drone, lfo);

    // Turn on the generative sequence
    this.generateBGMPatterns();
    this.bgmStep = 0;
    this.nextBgmNoteTime = ctx.currentTime + 0.1;
    this.bgmTimer = window.setInterval(() => this.scheduleBGM(), 50);
  }

  stopBGM() {
    if (this.bgmTimer !== null) {
      clearInterval(this.bgmTimer);
      this.bgmTimer = null;
    }
    this.bgmOscillators.forEach(osc => {
        try { osc.stop(); } catch(e){}
    });
    this.bgmOscillators = [];
    if (this.bgmGain) {
        this.bgmGain.disconnect();
        this.bgmGain = null;
    }
  }

  private generateBGMPatterns() {
      // D Minor Scale frequencies
      const bassScale = [36.71, 43.65, 49.00, 55.00, 65.41, 73.42]; // D1, F1, G1, A1, C2, D2
      const arpScale  = [146.8, 174.6, 196.0, 220.0, 261.6, 293.7, 349.2, 392.0]; // D3 to G4

      this.bgmBassPattern = [];
      for (let i = 0; i < 16; i++) {
          if (i % 4 === 0) {
              this.bgmBassPattern.push(bassScale[0]); // Strong root note on quarter beats
          } else if (Math.random() > 0.6) {
              this.bgmBassPattern.push(bassScale[Math.floor(Math.random() * bassScale.length)]);
          } else {
              this.bgmBassPattern.push(0); // Rest
          }
      }

      this.bgmArpPattern = [];
      for (let i = 0; i < 16; i++) {
          this.bgmArpPattern.push(arpScale[Math.floor(Math.random() * arpScale.length)]);
      }
  }

  private scheduleBGM() {
      if (!this.ctx || !this.enabled || !this.bgmGain) return;
      const scheduleAhead = 0.15; // sec
      const stepTime = 0.13; // ~115 BPM 16th note

      // Catch up if tab was backgrounded / frozen
      if (this.nextBgmNoteTime < this.ctx.currentTime) {
          this.nextBgmNoteTime = this.ctx.currentTime + 0.05;
      }

      while (this.nextBgmNoteTime < this.ctx.currentTime + scheduleAhead) {
          this.playBGMStep(this.nextBgmNoteTime, this.bgmStep);
          this.nextBgmNoteTime += stepTime;
          this.bgmStep = (this.bgmStep + 1) % 64;
      }
  }

  private playBGMStep(time: number, step: number) {
      const ctx = this.ctx!;
      const step16 = step % 16;

      // 1. Kick Drum (Thud) - Syncopated industrial pattern
      if (step16 === 0 || step16 === 6 || step16 === 10) {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.frequency.setValueAtTime(120, time);
          osc.frequency.exponentialRampToValueAtTime(30, time + 0.08);
          gain.gain.setValueAtTime(0.5, time);
          gain.gain.exponentialRampToValueAtTime(0.01, time + 0.3);
          osc.connect(gain).connect(this.bgmGain!);
          osc.start(time);
          osc.stop(time + 0.3);
      }

      // 2. Snare Drum (Noise Burst)
      if (step16 === 4 || step16 === 12) {
          const noise = ctx.createBufferSource();
          noise.buffer = this.getNoiseBuffer(ctx);
          const filter = ctx.createBiquadFilter();
          filter.type = "highpass";
          filter.frequency.setValueAtTime(1500, time);
          const gain = ctx.createGain();
          gain.gain.setValueAtTime(0.4, time);
          gain.gain.exponentialRampToValueAtTime(0.01, time + 0.15);
          noise.connect(filter).connect(gain).connect(this.bgmGain!);
          noise.start(time);
          noise.stop(time + 0.15);

          // Snare Tone punch
          const osc = ctx.createOscillator();
          osc.type = "triangle";
          osc.frequency.setValueAtTime(220, time);
          osc.frequency.exponentialRampToValueAtTime(60, time + 0.1);
          const punchGain = ctx.createGain();
          punchGain.gain.setValueAtTime(0.5, time);
          punchGain.gain.exponentialRampToValueAtTime(0.01, time + 0.1);
          osc.connect(punchGain).connect(this.bgmGain!);
          osc.start(time);
          osc.stop(time + 0.1);
      }

      // 3. Hi-Hat (Closed & Open)
      if (step16 % 2 === 0 || step16 === 3 || step16 === 15) {
          const isOpen = step16 === 14;
          const dur = isOpen ? 0.2 : 0.04;
          const noise = ctx.createBufferSource();
          noise.buffer = this.getNoiseBuffer(ctx);
          const filter = ctx.createBiquadFilter();
          filter.type = "bandpass";
          filter.frequency.setValueAtTime(7000, time);
          filter.Q.value = 1.5;
          const gain = ctx.createGain();
          gain.gain.setValueAtTime(0.12, time);
          gain.gain.exponentialRampToValueAtTime(0.01, time + dur);
          noise.connect(filter).connect(gain).connect(this.bgmGain!);
          noise.start(time);
          noise.stop(time + dur);
      }

      // 4. Bassline
      if (this.bgmBassPattern[step16] > 0) {
          const bassFreq = this.bgmBassPattern[step16];
          const osc = ctx.createOscillator();
          osc.type = "sawtooth";
          osc.frequency.setValueAtTime(bassFreq, time);
          const filter = ctx.createBiquadFilter();
          filter.type = "lowpass";
          filter.frequency.setValueAtTime(1200, time);
          filter.frequency.exponentialRampToValueAtTime(100, time + 0.15);
          filter.Q.value = 2;
          const gain = ctx.createGain();
          gain.gain.setValueAtTime(0.2, time);
          gain.gain.exponentialRampToValueAtTime(0.01, time + 0.15);
          osc.connect(filter).connect(gain).connect(this.bgmGain!);
          osc.start(time);
          osc.stop(time + 0.15);
      }

      // 5. Arp / Lead sequence
      if (step % 2 === 0 && Math.random() > 0.4) {
          const note = this.bgmArpPattern[(step / 2) % this.bgmArpPattern.length];
          const osc = ctx.createOscillator();
          osc.type = "square";
          osc.frequency.setValueAtTime(note, time);
          const filter = ctx.createBiquadFilter();
          filter.type = "lowpass";
          filter.frequency.setValueAtTime(3000, time);
          filter.frequency.exponentialRampToValueAtTime(400, time + 0.2);
          const gain = ctx.createGain();
          gain.gain.setValueAtTime(0.06, time);
          gain.gain.exponentialRampToValueAtTime(0.01, time + 0.2);
          osc.connect(filter).connect(gain).connect(this.bgmGain!);
          osc.start(time);
          osc.stop(time + 0.2);
      }

      // Mutate patterns every 4 bars
      if (step === 63) {
          this.generateBGMPatterns();
      }
  }

  playSelect() {
    if (!this.enabled) return;
    this.initCtx();
    const ctx = this.ctx!;
    if (!this.bgmGain) this.startBGM();
    
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    // Quick crisp high-tech click
    osc.frequency.setValueAtTime(1200, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1600, ctx.currentTime + 0.03);

    gain.gain.setValueAtTime(0.06, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05);

    osc.connect(gain);
    gain.connect(this.out());
    osc.start();
    osc.stop(ctx.currentTime + 0.05);
  }

  playOrder() {
    if (!this.enabled) return;
    this.initCtx();
    const ctx = this.ctx!;
    
    // Double affirmative radio click
    [0, 0.08].forEach(offset => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "square";
      osc.frequency.setValueAtTime(800, ctx.currentTime + offset);
      osc.frequency.setValueAtTime(600, ctx.currentTime + offset + 0.02);

      gain.gain.setValueAtTime(0.03, ctx.currentTime + offset);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + offset + 0.05);

      osc.connect(gain);
      gain.connect(this.out());
      osc.start(ctx.currentTime + offset);
      osc.stop(ctx.currentTime + offset + 0.05);
    });
  }

  playConstruction() {
    if (!this.enabled) return;
    this.initCtx();
    const ctx = this.ctx!;
    
    // Low mechanical machinery hum + metallic clank
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(60, ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(80, ctx.currentTime + 0.5);

    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.001, ctx.currentTime + 0.5);

    osc.connect(gain);
    gain.connect(this.out());
    osc.start();
    osc.stop(ctx.currentTime + 0.5);
    
    // High metallic ping
    const ping = ctx.createOscillator();
    const pingGain = ctx.createGain();
    ping.type = "sine";
    ping.frequency.setValueAtTime(1200, ctx.currentTime);
    ping.frequency.exponentialRampToValueAtTime(800, ctx.currentTime + 0.2);
    
    pingGain.gain.setValueAtTime(0.05, ctx.currentTime);
    pingGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
    
    ping.connect(pingGain);
    pingGain.connect(this.out());
    ping.start();
    ping.stop(ctx.currentTime + 0.2);
  }

  playClick() {
    if (!this.enabled) return;
    this.initCtx();
    const ctx = this.ctx!;
    if (!this.bgmGain) this.startBGM();

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    // Short UI confirmation noise
    osc.type = "triangle";
    osc.frequency.setValueAtTime(900, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(300, ctx.currentTime + 0.04);

    gain.gain.setValueAtTime(0.04, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05);

    osc.connect(gain);
    gain.connect(this.out());
    osc.start();
    osc.stop(ctx.currentTime + 0.05);
  }

  playBuildComplete() {
    if (!this.enabled) return;
    this.initCtx();
    const ctx = this.ctx!;
    
    // Military radio acknowledgment / readiness chime
    const freqs = [500, 650];
    freqs.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "square";
      osc.frequency.setValueAtTime(freq, ctx.currentTime + idx * 0.1);

      gain.gain.setValueAtTime(0.02, ctx.currentTime + idx * 0.1);
      gain.gain.linearRampToValueAtTime(0.001, ctx.currentTime + idx * 0.1 + 0.15);

      // Simple lowpass filter to muddy the square wave like military comms
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 1500;

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.out());
      osc.start(ctx.currentTime + idx * 0.1);
      osc.stop(ctx.currentTime + idx * 0.1 + 0.15);
    });
  }

  playExplosion() {
    if (!this.enabled) return;
    this.initCtx();
    const ctx = this.ctx!;
    
    // Deep Sub-Bass Rumble
    const subOsc = ctx.createOscillator();
    subOsc.type = 'sine';
    subOsc.frequency.setValueAtTime(80, ctx.currentTime);
    subOsc.frequency.exponentialRampToValueAtTime(20, ctx.currentTime + 0.6);
    
    const subGain = ctx.createGain();
    subGain.gain.setValueAtTime(1.0, ctx.currentTime);
    subGain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.8);
    subOsc.connect(subGain);
    subGain.connect(this.out());
    subOsc.start();
    subOsc.stop(ctx.currentTime + 0.8);

    // Filtered Noise Burst for debris/shockwave
    const bufferSize = ctx.sampleRate * 0.8; // 0.8 seconds long
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.2)); 
    }

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.Q.value = 0.5;
    filter.frequency.setValueAtTime(1500, ctx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(100, ctx.currentTime + 0.6);

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.8, ctx.currentTime);
    noiseGain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.8);

    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(this.out());

    noise.start();
    noise.stop(ctx.currentTime + 0.8);
  }

  playAlert() {
    if (!this.enabled) return;
    this.initCtx();
    const ctx = this.ctx!;
    
    // Realistic dual-tone klaxon (similar to air raid or red alert siren)
    const baseFreq = 350;
    
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();

    osc1.type = "sawtooth";
    osc2.type = "triangle";
    
    // Sweeps up and down rapidly
    osc1.frequency.setValueAtTime(baseFreq, ctx.currentTime);
    osc1.frequency.linearRampToValueAtTime(baseFreq * 1.5, ctx.currentTime + 0.4);
    osc1.frequency.linearRampToValueAtTime(baseFreq, ctx.currentTime + 0.8);
    
    osc2.frequency.setValueAtTime(baseFreq * 1.02, ctx.currentTime); // Slight phasing
    osc2.frequency.linearRampToValueAtTime((baseFreq * 1.02) * 1.5, ctx.currentTime + 0.4);
    osc2.frequency.linearRampToValueAtTime(baseFreq * 1.02, ctx.currentTime + 0.8);

    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.001, ctx.currentTime + 0.8);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(this.out());
    
    osc1.start();
    osc2.start();
    osc1.stop(ctx.currentTime + 0.8);
    osc2.stop(ctx.currentTime + 0.8);
  }

  playGunshot() {
    if (!this.enabled) return;
    this.initCtx();
    const ctx = this.ctx!;
    
    // Snappy noise burst for gunshot
    const bufferSize = ctx.sampleRate * 0.15; // very short
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
        // More aggressive curve for a sharper crack
        data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.03));
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    
    // Filter for metallic/snappy tone
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(2000, ctx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(500, ctx.currentTime + 0.1);
    
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.8, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);
    
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.out());
    
    // Low thump for the barrel explosion
    const thump = ctx.createOscillator();
    const thumpGain = ctx.createGain();
    thump.type = "sine";
    thump.frequency.setValueAtTime(150, ctx.currentTime);
    thump.frequency.exponentialRampToValueAtTime(40, ctx.currentTime + 0.1);
    
    thumpGain.gain.setValueAtTime(0.6, ctx.currentTime);
    thumpGain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);
    
    thump.connect(thumpGain);
    thumpGain.connect(this.out());

    noise.start();
    noise.stop(ctx.currentTime + 0.15);
    thump.start();
    thump.stop(ctx.currentTime + 0.1);
  }

  playLaser() {
    if (!this.enabled) return;
    this.initCtx();
    const ctx = this.ctx!;
    
    // Sci-fi high-energy pulse
    const duration = 0.12;

    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();

    osc1.type = "square";
    osc2.type = "sawtooth";
    
    // Rapid pitch envelope down
    osc1.frequency.setValueAtTime(2200, ctx.currentTime);
    osc1.frequency.exponentialRampToValueAtTime(200, ctx.currentTime + duration);
    
    osc2.frequency.setValueAtTime(1800, ctx.currentTime);
    osc2.frequency.exponentialRampToValueAtTime(150, ctx.currentTime + duration);

    // Tight filter contour
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.Q.value = 6; // high resonance for the "pew" zap
    filter.frequency.setValueAtTime(4000, ctx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(400, ctx.currentTime + duration);

    gain.gain.setValueAtTime(0.4, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);

    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(gain);
    gain.connect(this.out());
    
    osc1.start();
    osc2.start();
    osc1.stop(ctx.currentTime + duration);
    osc2.stop(ctx.currentTime + duration);
  }

  playLaunch() {
    if (!this.enabled) return;
    this.initCtx();
    const ctx = this.ctx!;
    
    // White noise whoosh
    const bufferSize = ctx.sampleRate * 0.5; 
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.setValueAtTime(400, ctx.currentTime);
    noiseFilter.frequency.linearRampToValueAtTime(1500, ctx.currentTime + 0.3);
    noiseFilter.Q.value = 1.2;

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0, ctx.currentTime);
    noiseGain.gain.linearRampToValueAtTime(0.5, ctx.currentTime + 0.1);
    noiseGain.gain.linearRampToValueAtTime(0.01, ctx.currentTime + 0.5);
    
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(this.out());
    
    noise.start();
    noise.stop(ctx.currentTime + 0.5);

    // Initial mechanical click/thump
    const thump = ctx.createOscillator();
    const thumpGain = ctx.createGain();
    thump.type = "sine";
    thump.frequency.setValueAtTime(100, ctx.currentTime);
    thump.frequency.exponentialRampToValueAtTime(30, ctx.currentTime + 0.1);
    
    thumpGain.gain.setValueAtTime(0.4, ctx.currentTime);
    thumpGain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);
    
    thump.connect(thumpGain);
    thumpGain.connect(this.out());
    thump.start();
    thump.stop(ctx.currentTime + 0.1);
  }

  playAllianceZap() {
    if (!this.enabled) return;
    this.initCtx();
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.type = "sine";
    osc.frequency.setValueAtTime(1500, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(400, ctx.currentTime + 0.1);
    
    gain.gain.setValueAtTime(0.25, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);
    
    osc.connect(gain);
    gain.connect(this.out());
    osc.start();
    osc.stop(ctx.currentTime + 0.1);
  }

  playCoalitionBoom() {
    if (!this.enabled) return;
    this.initCtx();
    const ctx = this.ctx!;
    
    const sub = ctx.createOscillator();
    const subGain = ctx.createGain();
    sub.type = "sawtooth";
    sub.frequency.setValueAtTime(140, ctx.currentTime);
    sub.frequency.exponentialRampToValueAtTime(35, ctx.currentTime + 0.2);
    
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(400, ctx.currentTime);
    
    subGain.gain.setValueAtTime(0.6, ctx.currentTime);
    subGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.22);
    
    sub.connect(filter).connect(subGain).connect(this.out());
    sub.start();
    sub.stop(ctx.currentTime + 0.22);
  }

  playUnionTesla() {
    if (!this.enabled) return;
    this.initCtx();
    const ctx = this.ctx!;
    
    for (let i = 0; i < 3; i++) {
      const offset = i * 0.03;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      
      osc.type = "triangle";
      osc.frequency.setValueAtTime(800 + Math.random() * 600, ctx.currentTime + offset);
      osc.frequency.exponentialRampToValueAtTime(100, ctx.currentTime + offset + 0.05);
      
      gain.gain.setValueAtTime(0.15, ctx.currentTime + offset);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + offset + 0.05);
      
      osc.connect(gain).connect(this.out());
      osc.start(ctx.currentTime + offset);
      osc.stop(ctx.currentTime + offset + 0.05);
    }
  }

  playSyndicateAcid() {
    if (!this.enabled) return;
    this.initCtx();
    const ctx = this.ctx!;
    
    const bufferSize = Math.floor(ctx.sampleRate * 0.15);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.sin(i * 0.01) * Math.exp(-i / (ctx.sampleRate * 0.05));
    }
    
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(1200, ctx.currentTime);
    filter.Q.value = 3.0;
    
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.4, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
    
    noise.connect(filter).connect(gain).connect(this.out());
    noise.start();
    noise.stop(ctx.currentTime + 0.15);
  }
}

export const sound = new RTSAudioEngine();
