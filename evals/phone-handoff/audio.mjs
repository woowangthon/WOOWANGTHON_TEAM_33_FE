// Lab-only audio conversion: PCM WAV -> 8 kHz G.711 mu-law -> PCM.
import { spawnSync } from 'node:child_process';

export function readWav(bytes) {
  if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Invalid WAV');
  let format, pcm;
  for (let at = 12; at + 8 <= bytes.length;) {
    const size = bytes.readUInt32LE(at + 4), start = at + 8;
    if (start + size > bytes.length) throw new Error('Truncated WAV');
    const id = bytes.toString('ascii', at, at + 4);
    if (id === 'fmt ') format = { codec: bytes.readUInt16LE(start), channels: bytes.readUInt16LE(start + 2), rate: bytes.readUInt32LE(start + 4), bits: bytes.readUInt16LE(start + 14) };
    if (id === 'data') pcm = bytes.subarray(start, start + size);
    at = start + size + (size % 2);
  }
  if (!pcm || format?.codec !== 1 || format?.bits !== 16 || format?.channels !== 1) throw new Error('Requires mono PCM16 WAV');
  return { pcm, rate: format.rate };
}

export function encodeMuLaw(value) {
  const sign = value < 0 ? 0x80 : 0;
  let magnitude = Math.min(Math.abs(value), 32635) + 0x84;
  let exponent = 7;
  for (let mask = 0x4000; exponent > 0 && !(magnitude & mask); mask >>= 1) exponent--;
  return (~(sign | (exponent << 4) | ((magnitude >> (exponent + 3)) & 0x0f))) & 0xff;
}

export function decodeMuLaw(value) {
  const encoded = (~value) & 0xff;
  const magnitude = (((encoded & 0x0f) << 3) + 0x84) << ((encoded >> 4) & 0x07);
  return encoded & 0x80 ? 0x84 - magnitude : magnitude - 0x84;
}

export function telephoneAudio(wav) {
  const { pcm, rate } = readWav(wav);
  const sourceLength = pcm.length / 2;
  const length = Math.floor(sourceLength * 8000 / rate);
  const result = Buffer.alloc(length);
  // Windowed-sinc low-pass resampler. Avoid aliasing when reducing to telephone bandwidth.
  const cutoff = Math.min(0.45, 3400 / rate), radius = 32;
  for (let i = 0; i < length; i++) {
    const position = i * rate / 8000;
    let sum = 0, weights = 0;
    for (let j = Math.ceil(position - radius); j <= Math.floor(position + radius); j++) {
      if (j < 0 || j >= sourceLength) continue;
      const distance = j - position;
      const sinc = distance === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * distance) / (Math.PI * distance);
      const window = 0.5 + 0.5 * Math.cos(Math.PI * distance / radius);
      sum += pcm.readInt16LE(j * 2) * sinc * window;
      weights += sinc * window;
    }
    result[i] = encodeMuLaw(Math.round(sum / weights));
  }
  return result;
}

export function pcm24k(muLaw) {
  const pcm = Buffer.alloc(muLaw.length * 6);
  for (let i = 0; i < muLaw.length; i++) {
    const current = decodeMuLaw(muLaw[i]);
    const next = decodeMuLaw(muLaw[Math.min(i + 1, muLaw.length - 1)]);
    for (let j = 0; j < 3; j++) pcm.writeInt16LE(Math.round(current + (next - current) * j / 3), (i * 3 + j) * 2);
  }
  return pcm;
}

export function pcmWav(pcm, rate = 24000) {
  const header = Buffer.alloc(44);
  header.write('RIFF'); header.writeUInt32LE(pcm.length + 36, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export function localSpeech(text, outputPath) {
  const script = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$speaker = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  $voice = $speaker.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -eq 'ko-KR' } | Select-Object -First 1
  if (-not $voice) { throw 'Korean voice unavailable' }
  $speaker.SelectVoice($voice.VoiceInfo.Name)
  $speaker.SetOutputToWaveFile($env:SHIELD_LAB_WAV)
  $speaker.Speak($env:SHIELD_LAB_TEXT)
  $speaker.SetOutputToNull()
} finally { $speaker.Dispose() }
`;
  const outcome = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    windowsHide: true, stdio: 'pipe', timeout: 20000,
    env: { ...process.env, SHIELD_LAB_TEXT: text, SHIELD_LAB_WAV: outputPath },
  });
  if (outcome.status !== 0) throw new Error('Local speech generation failed');
}
