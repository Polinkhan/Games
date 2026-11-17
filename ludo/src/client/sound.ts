import { settings } from './settings.ts';

export type SoundName = 'roll' | 'step' | 'capture' | 'home' | 'turn' | 'win' | 'error' | 'out';

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (!('AudioContext' in window)) return null;
  ctx ??= new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function tone(ac: AudioContext, at: number, freq: number, dur: number, gain: number, type: OscillatorType = 'sine'): void {
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, at);
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(gain, at + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(g).connect(ac.destination);
  osc.start(at);
  osc.stop(at + dur + 0.02);
}

function rattle(ac: AudioContext, at: number): void {
  for (let i = 0; i < 6; i++) {
    const len = 0.03;
    const buf = ac.createBuffer(1, Math.floor(ac.sampleRate * len), ac.sampleRate);
    const data = buf.getChannelData(0);
    for (let j = 0; j < data.length; j++) data[j] = (Math.random() * 2 - 1) * (1 - j / data.length);
    const src = ac.createBufferSource();
    const filter = ac.createBiquadFilter();
    const g = ac.createGain();
    filter.type = 'bandpass';
    filter.frequency.value = 1800 + Math.random() * 1500;
    g.gain.value = 0.18;
    src.buffer = buf;
    src.connect(filter).connect(g).connect(ac.destination);
    src.start(at + i * 0.07 + Math.random() * 0.02);
  }
}

export function playSound(name: SoundName): void {
  if (!settings.sound) return;
  const ac = audio();
  if (!ac) return;
  const at = ac.currentTime + 0.01;
  switch (name) {
    case 'roll':
      rattle(ac, at);
      break;
    case 'step':
      tone(ac, at, 660 + Math.random() * 60, 0.07, 0.05, 'triangle');
      break;
    case 'out':
      tone(ac, at, 440, 0.1, 0.07, 'triangle');
      tone(ac, at + 0.08, 660, 0.14, 0.07, 'triangle');
      break;
    case 'capture':
      tone(ac, at, 520, 0.12, 0.09, 'square');
      tone(ac, at + 0.1, 260, 0.25, 0.08, 'square');
      break;
    case 'home':
      [523, 659, 784, 1047].forEach((f, i) => tone(ac, at + i * 0.08, f, 0.22, 0.06, 'triangle'));
      break;
    case 'turn':
      tone(ac, at, 880, 0.12, 0.05);
      break;
    case 'win':
      [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(ac, at + i * 0.12, f, 0.3, 0.07, 'triangle'));
      break;
    case 'error':
      tone(ac, at, 200, 0.16, 0.06, 'square');
      break;
  }
}

export function buzz(ms: number): void {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* not supported */
  }
}
