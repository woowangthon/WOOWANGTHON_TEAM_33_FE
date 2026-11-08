// Bounded regression probe: re-read the SAME telephone-bandwidth audio, no TTS generation.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { telephoneAudio } from '../evals/phone-handoff/audio.mjs';
import { TextPipeline } from '../evals/phone-handoff/text-pipeline.mjs';
const apiKey = process.env.OPENAI_API_KEY || process.env.SERVICE_OPENAI_API_KEY;
if (!apiKey) throw new Error('OpenAI credential missing');
const pipeline = new TextPipeline({ apiKey, model: process.env.SERVICE_OPENAI_MODEL || 'gpt-6-luna' });
const output = new URL('../outputs/phone-text-verification/', import.meta.url);
await mkdir(output, { recursive: true });
const rows = [];
const windowsSource = process.env.SHIELD_LAB_SOURCE === 'windows';
for (const id of windowsSource ? ['profanity'] : ['criticism', 'profanity']) {
  const bytes = await readFile(new URL(windowsSource ? `../outputs/phone-audio-check/${id}.wav` : `../outputs/phone-handoff-verification/cloud-input/${id}.wav`, import.meta.url));
  const transcript = await pipeline.verifyAudio(telephoneAudio(bytes));
  rows.push({ id, transcript });
  console.log(JSON.stringify(rows.at(-1)));
}
await writeFile(new URL(`retranscription-probe${windowsSource ? '-windows' : ''}.json`, output), JSON.stringify({ source: windowsSource ? 'windows' : 'cloud', rows, usage: pipeline.usage }, null, 2));
