import { useSettings } from './settings';

export type SoundName = 'deal' | 'play' | 'win' | 'turn' | 'reveal' | 'score' | 'error';

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === 'undefined' || !('AudioContext' in window)) return null;
  ctx ??= new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function noiseBurst(ac: AudioContext, at: number, dur: number, gain: number, freq: number) {
  const buffer = ac.createBuffer(1, Math.floor(ac.sampleRate * dur), ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 2;
  const src = ac.createBufferSource();
  src.buffer = buffer;
  const filter = ac.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = freq;
  const g = ac.createGain();
  g.gain.value = gain;
  src.connect(filter).connect(g).connect(ac.destination);
  src.start(at);
}

function tone(ac: AudioContext, at: number, freq: number, dur: number, gain: number, type: OscillatorType = 'sine') {
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, at);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(g).connect(ac.destination);
  osc.start(at);
  osc.stop(at + dur + 0.02);
}

/** Short synthesized effects; no audio files needed. */
export function playSound(name: SoundName): void {
  if (!useSettings.getState().sound) return;
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime;
  switch (name) {
    case 'deal':
      for (let i = 0; i < 6; i++) noiseBurst(ac, t + i * 0.06, 0.05, 0.25, 2400);
      break;
    case 'play':
      noiseBurst(ac, t, 0.08, 0.5, 1800);
      break;
    case 'win':
      noiseBurst(ac, t, 0.12, 0.3, 1200);
      tone(ac, t + 0.02, 660, 0.18, 0.06);
      break;
    case 'turn':
      tone(ac, t, 880, 0.12, 0.07);
      tone(ac, t + 0.1, 1320, 0.16, 0.05);
      break;
    case 'reveal':
      tone(ac, t, 523, 0.14, 0.07, 'triangle');
      tone(ac, t + 0.12, 784, 0.22, 0.07, 'triangle');
      break;
    case 'score':
      [523, 659, 784].forEach((f, i) => tone(ac, t + i * 0.09, f, 0.22, 0.06, 'triangle'));
      break;
    case 'error':
      tone(ac, t, 220, 0.16, 0.06, 'square');
      break;
  }
}

export function buzz(ms = 10): void {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* unsupported */
  }
}
