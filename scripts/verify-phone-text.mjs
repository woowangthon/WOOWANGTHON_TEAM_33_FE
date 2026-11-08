// Local WebSocket call emulation with real STT/AI. No generated speech and no PSTN call.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { telephoneAudio, pcm24k } from '../evals/phone-handoff/audio.mjs';
import { FilterRelay } from '../evals/phone-handoff/filter-relay.mjs';
import { TextPipeline, needsSafetyCheck, transcriptionContext } from '../evals/phone-handoff/text-pipeline.mjs';
import { reviewNativeAudio } from '../evals/phone-handoff/native-review.mjs';
const Ws = createRequire(import.meta.url)('next/dist/compiled/ws');
const apiKey = process.env.OPENAI_API_KEY || process.env.SERVICE_OPENAI_API_KEY;
if (!apiKey) throw new Error('OpenAI credential missing');
const output = new URL('../outputs/phone-text-verification/', import.meta.url);
await mkdir(output, { recursive: true });
const samples = JSON.parse(await readFile(new URL('../evals/phone-audio/fixtures.json', import.meta.url), 'utf8')).samples;
const allCases = [
  ...samples.map(sample => ({ ...sample, fixtureId: sample.id, source: 'cloud' })),
  { ...samples.find(sample => sample.id === 'profanity'), id: 'profanity-windows', fixtureId: 'profanity', source: 'windows' },
  { id: 'plea-control', fixtureId: 'plea-control', source: 'control', takeover: false },
];
const selectedIds = process.env.SHIELD_LAB_CASES?.split(',');
const cases = selectedIds ? allCases.filter(sample => selectedIds.includes(sample.id)) : allCases;
if (!cases.length || selectedIds?.some(id => !allCases.some(sample => sample.id === id))) throw new Error('Unknown_lab_case');
const resultFile = selectedIds ? 'result-selected.json' : 'result.json';
// Held in the evaluation runner only. These expected facts NEVER enter an AI prompt.
const requiredFacts = {
  normal: [/집\s*앞/, /쓰레기/, /현장|확인/, /수거|치워/],
  criticism: [/도로/, /복구/, /일정/],
  profanity: [/집\s*앞/, /쓰레기/, /수거|치워/],
  'quoted-report': [/옆집/, /욕설|욕/, /신고/],
  'plea-control': [/집\s*앞/, /쓰레기/, /수거|치워/],
};
const report = {
  checkedAt: new Date().toISOString(), synthetic: true, architecture: 'Live STT -> separate short safety call; re-transcribe original audio -> neutral TEXT + facts; human speech remains connected.',
  implementation: 'text-only-v7-facts-display-and-quoted-expression-masking', selectedCases: cases.map(sample => sample.id), results: [],
  limitations: ['Local carrier and officer emulators, no actual 070/SIP/microphone/browser display', 'Six synthetic recordings of five scenarios are regression checks, not an accuracy benchmark', 'Known end-of-turn in test; production VAD and continuous multi-turn speech not tested', 'First abusive sound may reach officer before detection', 'Fast protection uses a conservative phrase lexicon; unknown expressions can be missed', 'Re-transcription and native audio review may still be wrong; model agreement is not truth'],
};
const safeError = error => String(error?.code || error?.message || 'failed').replace(/[^a-zA-Z0-9_. -]/g, '').slice(0, 120);
async function until(predicate, timeout = 25000) {
  const at = performance.now();
  while (!predicate()) { if (performance.now() - at > timeout) throw new Error('Lab_timeout'); await delay(5); }
}

async function verify(sample) {
  const row = { id: sample.id, fixtureVoice: sample.source, expectedShield: sample.takeover, checks: {}, safety: [] };
  const pipeline = new TextPipeline({ apiKey, model: process.env.SERVICE_OPENAI_MODEL || 'gpt-6-luna' });
  let server, carrier, officer, carrierSocket, officerSocket, realtime, relay;
  const callerEvents = [], officerEvents = [], errors = [];
  let configured = false, liveFinal, partial = '', readyText, guardPromise = Promise.resolve(), guardBusy = false, queuedGuard = null, guardCalls = 0;
  let sentAt, commitAt, shieldAt, firstDeltaAt, textAt, receivedFrames = 0, analysisFrames = 0;
  const muLaw = telephoneAudio(await readFile(new URL(sample.source === 'control'
    ? `../outputs/phone-text-verification/control/${sample.fixtureId}.wav`
    : sample.source === 'windows'
    ? `../outputs/phone-audio-check/${sample.fixtureId}.wav`
    : `../outputs/phone-handoff-verification/cloud-input/${sample.fixtureId}.wav`, import.meta.url)));
  row.audioSeconds = muLaw.length / 8000;
  try {
    server = new Ws.WebSocketServer({ host: '127.0.0.1', port: 0 });
    await new Promise(resolve => server.once('listening', resolve));
    server.on('connection', (socket, request) => {
      if (request.url === '/caller') carrierSocket = socket;
      else officerSocket = socket;
      socket.on('message', bytes => {
        const event = JSON.parse(bytes.toString());
        if (event.event === 'start') relay.start(event.callId);
        if (event.event === 'media' && request.url === '/caller') { relay.fromCaller(event.payload); receivedFrames++; }
        else if (event.event === 'media') relay.fromOfficer(event.payload);
      });
    });
    const root = `ws://127.0.0.1:${server.address().port}`;
    carrier = new Ws(`${root}/caller`); officer = new Ws(`${root}/officer`);
    carrier.on('message', bytes => callerEvents.push(JSON.parse(bytes.toString())));
    officer.on('message', bytes => {
      const event = JSON.parse(bytes.toString()); officerEvents.push(event);
      if (event.event === 'neutral_text') textAt = performance.now();
    });
    await until(() => carrier.readyState === Ws.OPEN && officer.readyState === Ws.OPEN && carrierSocket && officerSocket);
    realtime = new Ws('wss://api.openai.com/v1/realtime?intent=transcription', { headers: { Authorization: `Bearer ${apiKey}` }, handshakeTimeout: 15000 });
    realtime.on('error', () => errors.push('Realtime_connection_failed'));
    realtime.on('message', bytes => {
      const event = JSON.parse(bytes.toString());
      if (event.type === 'error') errors.push(String(event.error?.code || 'Realtime_error'));
      if (event.type === 'session.updated') configured = true;
      if (event.type === 'conversation.item.input_audio_transcription.failed') errors.push('Transcription_failed');
      if (event.type === 'conversation.item.input_audio_transcription.delta') {
        firstDeltaAt ??= performance.now(); partial += event.delta || '';
        // No summary work in the protection path. Coalesce newer partials instead of queueing stale text.
        if (needsSafetyCheck(partial) && partial.trim().length >= 6) queueGuard(partial, 'live');
      }
      if (event.type === 'conversation.item.input_audio_transcription.completed') liveFinal = event.transcript;
    });
    await until(() => realtime.readyState === Ws.OPEN || errors.length);
    if (errors.length) throw new Error(errors[0]);
    realtime.send(JSON.stringify({ type: 'session.update', session: { type: 'transcription', audio: { input: {
      format: { type: 'audio/pcm', rate: 24000 },
      transcription: { model: 'gpt-live-transcribe', languages: ['ko'], delay: 'low', prompt: transcriptionContext },
      turn_detection: null,
    } } } }));
    await until(() => configured || errors.length);
    if (errors.length) throw new Error(errors[0]);
    relay = new FilterRelay({
      caller: event => carrierSocket.send(JSON.stringify(event)),
      officer: event => officerSocket.send(JSON.stringify(event)),
      onCallerAudio: payload => {
        analysisFrames++;
        realtime.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: pcm24k(Buffer.from(payload, 'base64')).toString('base64') }));
      },
    });
    function applySafety(result, transcript, source, started) {
      row.safety.push({ ...result, transcript, source, elapsedMs: Math.round(performance.now() - started) });
      if (relay.enableShield({ category: 'profanity', protectiveTakeoverRecommended: result.directAbuse, evidence: result.evidence }, transcript)) shieldAt = performance.now();
    }
    function queueGuard(transcript, source) {
      if (relay?.mode === 'shield' || guardCalls >= 3) return;
      queuedGuard = { transcript, source };
      if (guardBusy) return;
      guardBusy = true;
      guardPromise = (async () => {
        while (queuedGuard && relay.mode !== 'shield' && guardCalls < 3) {
          const item = queuedGuard; queuedGuard = null; guardCalls++;
          const started = performance.now();
          applySafety(await pipeline.checkSafety(item.transcript), item.transcript, item.source, started);
        }
      })().catch(error => errors.push(safeError(error))).finally(() => { guardBusy = false; });
    }
    carrier.send(JSON.stringify({ event: 'start', callId: `LOCAL-${sample.id}` }));
    await until(() => relay.callId);
    // A non-silent synthetic frame acts as the officer microphone in this emulator.
    const humanFrame = muLaw.subarray(Math.floor(muLaw.length / 2), Math.floor(muLaw.length / 2) + 160).toString('base64');
    officer.send(JSON.stringify({ event: 'media', payload: humanFrame }));
    await until(() => callerEvents.length);
    row.checks.officerSpeechBeforeFilter = callerEvents[0].media.payload === humanFrame;
    sentAt = performance.now(); let frameCount = 0;
    for (let at = 0; at < muLaw.length; at += 160) {
      await delay(Math.max(0, sentAt + at / 8 - performance.now()));
      const frame = Buffer.alloc(160, 0xff); muLaw.copy(frame, 0, at, Math.min(at + 160, muLaw.length));
      carrier.send(JSON.stringify({ event: 'media', payload: frame.toString('base64') })); frameCount++;
    }
    await until(() => receivedFrames === frameCount);
    commitAt = performance.now();
    realtime.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
    // Re-check original audio immediately, without waiting for the safety classifier or live final.
    // Start independent audio inspection only when the live transcript looked suspicious
    // but the fast protection path has not confirmed a direct attack. At most once per turn.
    const fallback = needsSafetyCheck(partial) && !shieldAt && !row.safety.some(result => result.scope === 'reported_speech')
      ? reviewNativeAudio(muLaw, apiKey).then(value => ({ value }), error => ({ error: safeError(error) }))
      : null;
    let reviewedTranscript = await pipeline.verifyAudio(muLaw);
    row.audioRecheckFinishedAfterCommitMs = Math.round(performance.now() - commitAt);
    row.secondaryTranscript = reviewedTranscript;
    if (fallback) {
      const inspected = await fallback;
      row.nativeReview = inspected.value || { failed: true, error: inspected.error };
      if (inspected.value && !inspected.value.uncertain) {
        reviewedTranscript = inspected.value.transcript;
        if (inspected.value.protectionNeedsReview) row.reviewRequired = true;
        applySafety(inspected.value, reviewedTranscript, 'native_audio_review', performance.now() - inspected.value.elapsedMs);
      } else row.reviewRequired = true;
    }
    // Final protection re-check uses the independent audio transcript and stays parallel to text creation.
    const finalSafetyAt = performance.now();
    const finalSafety = pipeline.checkSafety(reviewedTranscript).then(result => applySafety(result, reviewedTranscript, 'audio_recheck', finalSafetyAt));
    readyText = await pipeline.neutralize(reviewedTranscript);
    relay.publishText({ turnId: 'turn-1', revision: 1, text: readyText.text, facts: readyText.facts, status: row.reviewRequired ? 'needs_review' : 'audio_rechecked' });
    await until(() => textAt);
    await finalSafety; await guardPromise;
    await until(() => typeof liveFinal === 'string' || errors.length);
    if (errors.length) throw new Error(errors[0]);
    row.liveTranscript = liveFinal; row.reviewedTranscript = reviewedTranscript;
    row.text = readyText.text; row.facts = readyText.facts;
    row.displayPayload = officerEvents.find(e => e.event === 'neutral_text');
    row.shieldActivated = !!shieldAt;
    row.shieldFromAudioStartMs = shieldAt ? Math.round(shieldAt - sentAt) : null;
    row.shieldAfterUtteranceEndMs = shieldAt ? Math.round(shieldAt - commitAt) : null;
    // Separate functional routing from timely protection: a late cutoff cannot undo exposure.
    row.protectedBeforeUtteranceEnd = sample.takeover ? !!shieldAt && shieldAt < commitAt : null;
    row.firstDeltaFromAudioStartMs = Math.round(firstDeltaAt - sentAt);
    row.textDeliveredAfterCommitMs = Math.round(textAt - commitAt);
    row.textDeliveredFromStartMs = Math.round(textAt - sentAt);
    row.checks.expectedShield = row.shieldActivated === sample.takeover;
    row.checks.requiredFactsInReviewedAudio = requiredFacts[sample.fixtureId].every(pattern => pattern.test(reviewedTranscript));
    const displayed = [readyText.text, ...readyText.facts.map(fact => fact.value)].join(' ');
    row.checks.requiredFactsOnScreen = requiredFacts[sample.fixtureId].every(pattern => pattern.test(displayed));
    row.checks.noProfanityOnScreen = !/씨발|시발(?!점)|병신|개새끼/.test(displayed);
    row.checks.textDeliveredExactly = row.displayPayload.text === readyText.text && row.displayPayload.facts.length === readyText.facts.length;
    row.checks.textOnlyOfficer = callerEvents.every(e => e.event === 'media') && callerEvents.length === 1;
    row.checks.allIncomingAudioAnalyzed = analysisFrames === frameCount;
    if (shieldAt) {
      await delay(20);
      const beforeOfficer = officerEvents.filter(e => e.event === 'media').length;
      const beforeCaller = callerEvents.length;
      carrier.send(JSON.stringify({ event: 'media', payload: humanFrame }));
      officer.send(JSON.stringify({ event: 'media', payload: humanFrame }));
      await until(() => receivedFrames === frameCount + 1 && callerEvents.length === beforeCaller + 1);
      row.checks.rawCallerAudioBlocked = officerEvents.filter(e => e.event === 'media').length === beforeOfficer;
      row.checks.humanMicrophoneUninterrupted = callerEvents.at(-1).media.payload === humanFrame;
      row.checks.analysisContinuesWhileShielded = analysisFrames === frameCount + 1;
      row.checks.sameCall = relay.callId === `LOCAL-${sample.id}` && carrier.readyState === Ws.OPEN;
      relay.resume();
      carrier.send(JSON.stringify({ event: 'media', payload: humanFrame }));
      await until(() => officerEvents.filter(e => e.event === 'media').length === beforeOfficer + 1);
      row.checks.manualResumeWorks = true;
    } else row.checks.originalAudioPreserved = officerEvents.filter(e => e.event === 'media').length === frameCount;
    row.events = relay.events;
    row.passed = Object.values(row.checks).every(Boolean);
  } catch (error) { row.passed = false; row.error = safeError(error); }
  finally {
    relay?.end(); realtime?.terminate(); carrier?.terminate(); officer?.terminate();
    server?.clients.forEach(socket => socket.terminate());
    if (server) await new Promise(resolve => server.close(resolve));
    row.usage = pipeline.usage;
  }
  return row;
}
for (const sample of cases) {
  const row = await verify(sample); report.results.push(row);
  await writeFile(new URL(resultFile, output), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ id: row.id, passed: row.passed, shieldMs: row.shieldFromAudioStartMs, textAfterCommitMs: row.textDeliveredAfterCommitMs, reviewedTranscript: row.reviewedTranscript, checks: row.checks, error: row.error }));
  if (row.error) break;
}
report.passed = report.results.length === cases.length && report.results.every(row => row.passed);
await writeFile(new URL(resultFile, output), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ passed: report.passed, count: report.results.length, report: fileURLToPath(new URL(resultFile, output)) }));
if (!report.passed) process.exitCode = 1;
