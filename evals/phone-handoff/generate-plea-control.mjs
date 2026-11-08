// Extra regression input only. TTS is never used in the runtime response path.
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { localSpeech } from './audio.mjs';
const output = new URL('../../outputs/phone-text-verification/control/', import.meta.url);
await mkdir(output, { recursive: true });
const fixture = { id: 'plea-control', text: '제발, 너희는 일을 왜 그따위로 하냐? 집 앞 쓰레기를 치워 달라고 했잖아.', directAbuse: false, expectedShield: false, synthetic: true };
localSpeech(fixture.text, fileURLToPath(new URL('plea-control.wav', output)));
await writeFile(new URL('fixture.json', output), JSON.stringify(fixture, null, 2));
