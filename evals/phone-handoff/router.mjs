// Experimental routing core, not connected to a carrier or a production portal.
export class HandoffRouter {
  constructor({ caller, officer, onCallerAudio }) {
    this.caller = caller;
    this.officer = officer;
    this.onCallerAudio = onCallerAudio;
    this.mode = 'human';
    this.epoch = 0;
    this.callId = null;
    this.events = [];
  }
  start(callId) {
    if (this.callId) throw new Error('Call already started');
    this.callId = callId;
  }
  fromCaller(payload) {
    if (!this.callId || this.mode === 'ended') return;
    this.onCallerAudio(payload);
    if (this.mode === 'human') this.officer({ event: 'media', payload, epoch: this.epoch });
  }
  fromOfficer(payload, epoch) {
    if (this.mode === 'human' && epoch === this.epoch) this.caller({ event: 'media', media: { payload } });
  }
  fromAi(payload, epoch) {
    if (this.mode === 'ai' && epoch === this.epoch) this.caller({ event: 'media', media: { payload } });
  }
  takeover(decision, transcript) {
    if (!decision.protectiveTakeoverRecommended || !['profanity', 'threat'].includes(decision.category)) return false;
    if (!decision.evidence || !transcript.includes(decision.evidence) || this.mode !== 'human') return false;
    this.mode = 'ai';
    this.epoch++;
    // Receivers must drop queued playback. An actual browser audio queue remains to be tested.
    this.officer({ event: 'clear', epoch: this.epoch });
    this.caller({ event: 'clear' });
    this.events.push({ type: 'automatic_takeover', callId: this.callId, at: performance.now() });
    return true;
  }
  resume() {
    if (this.mode !== 'ai') return false;
    this.mode = 'human';
    this.epoch++;
    this.caller({ event: 'clear' });
    this.officer({ event: 'clear', epoch: this.epoch });
    this.events.push({ type: 'manual_resume', callId: this.callId, at: performance.now() });
    return true;
  }
  end() {
    this.mode = 'ended';
    this.epoch++;
  }
}
