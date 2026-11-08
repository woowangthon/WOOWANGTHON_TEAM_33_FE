import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { cloudSpeech } from './speech.mjs';
const key = process.env.OPENAI_API_KEY || process.env.SERVICE_OPENAI_API_KEY;
if (!key) throw new Error('OpenAI credential missing');
const samples = JSON.parse(await readFile(new URL('../phone-audio/fixtures.json', import.meta.url), 'utf8')).samples;
const output = new URL('../../outputs/phone-handoff-verification/cloud-input/', import.meta.url);
await mkdir(output, { recursive: true });
const results = [];
for (const sample of samples) {
  const result = await cloudSpeech(sample.text, new URL(`${sample.id}.wav`, output), key);
  results.push({ id: sample.id, ...result });
  await writeFile(new URL('generation.json', output), JSON.stringify({ synthetic: true, results }, null, 2) + '\n');
  console.log(JSON.stringify({ id: sample.id, transcriptMatchesInput: result.transcriptMatchesInput, audioSeconds: result.audioSeconds, firstAudioMs: result.firstAudioMs }));
  if (!result.transcriptMatchesInput) throw new Error('Generated transcript differs from fixture; inspect before evaluation');
}
