import type { MusicPreset3D } from '../types/studio3d';

/**
 * Self-contained Web Audio synthesizer + custom MP3 file mixer.
 * Routes audio to both live speakers AND a MediaStreamAudioDestinationNode
 * so MediaRecorder embeds crisp background music inside exported 9:16 videos.
 */
export class Studio3DAudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private streamDest: MediaStreamAudioDestinationNode | null = null;
  private schedulerId: number | null = null;
  private mp3Source: AudioBufferSourceNode | null = null;
  private mp3BufferCache = new Map<string, AudioBuffer>();
  private step = 0;
  private nextNoteTime = 0;
  private playing = false;
  private preset: MusicPreset3D = 'upbeat-synth';
  private customUrl: string | null = null;
  private volume = 0.65;

  private ensureContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;

    if (!this.ctx) {
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.volume;
      this.masterGain.connect(this.ctx.destination);
      this.streamDest = this.ctx.createMediaStreamDestination();
      this.masterGain.connect(this.streamDest);
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  public getRecordingAudioStream(): MediaStream | null {
    this.ensureContext();
    return this.streamDest?.stream ?? null;
  }

  public setVolume(vol: number) {
    this.volume = Math.min(1, Math.max(0, vol));
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.04);
    }
  }

  public async configure(preset: MusicPreset3D, customUrl: string | null, volume: number) {
    const presetChanged = preset !== this.preset || customUrl !== this.customUrl;
    this.preset = preset;
    this.customUrl = customUrl;
    this.setVolume(volume);

    if (this.playing && presetChanged) {
      this.stop();
      await this.start();
    }
  }

  public async start() {
    if (this.preset === 'none') {
      this.stop();
      return;
    }

    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;

    this.stopNodesOnly();
    this.playing = true;

    if (this.preset === 'custom-mp3' && this.customUrl) {
      try {
        let decoded = this.mp3BufferCache.get(this.customUrl);
        if (!decoded) {
          const resp = await fetch(this.customUrl);
          const arrBuf = await resp.arrayBuffer();
          decoded = await ctx.decodeAudioData(arrBuf);
          this.mp3BufferCache.set(this.customUrl, decoded);
        }
        if (!this.playing) return;
        const src = ctx.createBufferSource();
        src.buffer = decoded;
        src.loop = true;
        src.connect(this.masterGain);
        src.start(0);
        this.mp3Source = src;
        return;
      } catch {
        // Fallback smoothly to built-in synth if custom MP3 fails decode
      }
    }

    this.step = 0;
    this.nextNoteTime = ctx.currentTime + 0.05;
    this.schedulerId = window.setInterval(() => {
      this.scheduleSynthBeat();
    }, 45);
  }

  private scheduleSynthBeat() {
    if (!this.playing || !this.ctx || !this.masterGain) return;

    const bpm =
      this.preset === 'upbeat-synth'
        ? 128
        : this.preset === 'epic-trail'
          ? 116
          : 96; // lofi-stride
    const sixteenthDur = 60 / bpm / 4;

    while (this.nextNoteTime < this.ctx.currentTime + 0.16) {
      this.triggerStep(this.step, this.nextNoteTime);
      this.nextNoteTime += sixteenthDur;
      this.step = (this.step + 1) % 32;
    }
  }

  private triggerStep(step: number, time: number) {
    if (!this.ctx || !this.masterGain) return;

    const isKick = step % 4 === 0;
    const isSnare = this.preset === 'lofi-stride' ? step % 8 === 4 : step % 8 === 4;
    const isHat = step % 2 === 1;

    // Kick drum
    if (isKick) {
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(135, time);
      osc.frequency.exponentialRampToValueAtTime(42, time + 0.12);
      g.gain.setValueAtTime(0.45, time);
      g.gain.exponentialRampToValueAtTime(0.001, time + 0.18);
      osc.connect(g);
      g.connect(this.masterGain);
      osc.start(time);
      osc.stop(time + 0.19);
    }

    // Soft clap / snare pulse
    if (isSnare) {
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(220, time);
      osc.frequency.exponentialRampToValueAtTime(90, time + 0.09);
      g.gain.setValueAtTime(0.16, time);
      g.gain.exponentialRampToValueAtTime(0.001, time + 0.1);
      osc.connect(g);
      g.connect(this.masterGain);
      osc.start(time);
      osc.stop(time + 0.11);
    }

    // Crisp hi-hat tick
    if (isHat && this.preset !== 'epic-trail') {
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(this.preset === 'upbeat-synth' ? 6200 : 4200, time);
      g.gain.setValueAtTime(0.025, time);
      g.gain.exponentialRampToValueAtTime(0.001, time + 0.03);
      osc.connect(g);
      g.connect(this.masterGain);
      osc.start(time);
      osc.stop(time + 0.035);
    }

    // Melodic bass & arpeggio notes
    const scaleUpbeat = [130.81, 164.81, 196.0, 246.94, 261.63, 196.0, 164.81, 220.0];
    const scaleLofi = [174.61, 220.0, 261.63, 329.63, 293.66, 220.0, 196.0, 246.94];
    const scaleEpic = [110.0, 164.81, 220.0, 261.63, 329.63, 261.63, 220.0, 196.0];

    if (step % 2 === 0) {
      const idx = Math.floor(step / 2) % 8;
      const freq =
        this.preset === 'upbeat-synth'
          ? scaleUpbeat[idx]
          : this.preset === 'epic-trail'
            ? scaleEpic[idx]
            : scaleLofi[idx];

      const osc = this.ctx.createOscillator();
      const filter = this.ctx.createBiquadFilter();
      const g = this.ctx.createGain();

      osc.type = this.preset === 'lofi-stride' ? 'sine' : 'sawtooth';
      osc.frequency.setValueAtTime(
        this.preset === 'lofi-stride' ? freq * 1.5 : freq * (step % 8 === 0 ? 1 : 2),
        time,
      );
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(this.preset === 'lofi-stride' ? 900 : 1900, time);

      g.gain.setValueAtTime(0.001, time);
      g.gain.linearRampToValueAtTime(this.preset === 'epic-trail' ? 0.14 : 0.1, time + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, time + 0.24);

      osc.connect(filter);
      filter.connect(g);
      g.connect(this.masterGain);
      osc.start(time);
      osc.stop(time + 0.26);
    }
  }

  private stopNodesOnly() {
    if (this.schedulerId !== null) {
      window.clearInterval(this.schedulerId);
      this.schedulerId = null;
    }
    if (this.mp3Source) {
      try {
        this.mp3Source.stop();
        this.mp3Source.disconnect();
      } catch {
        // ignore already stopped
      }
      this.mp3Source = null;
    }
  }

  public stop() {
    this.playing = false;
    this.stopNodesOnly();
  }

  public dispose() {
    this.stop();
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
      this.masterGain = null;
      this.streamDest = null;
    }
  }
}
