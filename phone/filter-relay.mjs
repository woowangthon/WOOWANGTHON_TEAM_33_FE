// Active design: sanitized TEXT goes to the officer; a human ALWAYS answers.
// A carrier/actual browser speaker is not wired into this lab core.
export class FilterRelay {
  constructor({ caller, officer, onCallerAudio }) {
    this.caller = caller; this.officer = officer; this.onCallerAudio = onCallerAudio;
    this.mode = 'human'; this.epoch = 0; this.callId = null; this.events = [];
    this.revisions = new Map();
  }
  start(callId) {
    if (this.callId) throw new Error('Call already started');
    this.callId = callId;
  }
  fromCaller(payload) {
    if (!this.callId || this.mode === 'ended') return;
    this.onCallerAudio(payload);
    if (this.mode === 'human') this.officer({ event: 'media', payload, source: 'original', epoch: this.epoch });
  }
  fromOfficer(payload) {
    // Incoming filtering must not mute the officer's microphone.
    if (this.callId && this.mode !== 'ended') this.caller({ event: 'media', media: { payload } });
  }
  publishText({ turnId, revision, text, facts = [], status = 'audio_rechecked' }) {
    if (!this.callId || this.mode === 'ended' || !turnId || !Number.isInteger(revision) || typeof text !== 'string' || !text.trim()) return false;
    if (revision <= (this.revisions.get(turnId) ?? -1)) return false;
    this.revisions.set(turnId, revision);
    // Explicit projection prevents raw transcript/evidence/abusive phrases being leaked by extra fields.
    this.officer({ event: 'neutral_text', callId: this.callId, turnId, revision, text, status,
      facts: facts.map(fact => ({ kind: fact.kind, value: fact.value })) });
    return true;
  }
  enableShield(decision, transcript) {
    if (this.mode !== 'human' || !decision.protectiveTakeoverRecommended || !['profanity', 'threat'].includes(decision.category)) return false;
    if (!decision.evidence || !transcript.includes(decision.evidence)) return false;
    this.mode = 'shield'; this.epoch++;
    this.officer({ event: 'clear', epoch: this.epoch });
    this.events.push({ type: 'automatic_filter_enabled', callId: this.callId, at: performance.now() });
    return true;
  }
  resume() {
    if (this.mode !== 'shield') return false;
    this.mode = 'human'; this.epoch++;
    this.officer({ event: 'clear', epoch: this.epoch });
    this.events.push({ type: 'original_audio_restored', callId: this.callId, at: performance.now() });
    return true;
  }
  end() { this.mode = 'ended'; this.epoch++; }
}
