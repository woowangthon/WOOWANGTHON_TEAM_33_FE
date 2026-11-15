// Relay reviewed caller audio and sanitized text while preserving the human response path.
import {DelayedAudio} from './delayed-audio.mjs';
import {ReviewedAudio} from './reviewed-audio.mjs';
export class FilterRelay {
  constructor({ caller, officer, onCallerAudio, reviewed=false, textOnlyBothDirections=false, delayMs=0, onAudioError=()=>{}, now }) {
    this.caller = caller; this.officer = officer; this.onCallerAudio = onCallerAudio;
    this.mode = 'human'; this.epoch = 0; this.callId = null; this.events = [];
    this.revisions = new Map();
    this.reviewed=reviewed;
    this.textOnlyBothDirections=textOnlyBothDirections;
    const onFrame=(payload,range)=>{if(this.mode==='human')this.officer({event:'media',payload,source:reviewed?'reviewed':'original',epoch:this.epoch,...(range?{range}:{})});};
    this.playback=reviewed?new ReviewedAudio({onFrame,onError:onAudioError,now}):new DelayedAudio({delayMs,now,onFrame,onOverflow:onAudioError});
  }
  start(callId) {
    if (this.callId) throw new Error('Call already started');
    this.callId = callId;
  }
  fromCaller(payload,pcm) {
    if (!this.callId || this.mode === 'ended') return;
    // Keep the timeline continuous through protection and resume. Clear queued audio below.
    if(this.reviewed){this.playback.push(payload);if(this.mode!=='human')this.playback.clear();}
    else if (this.mode === 'human') this.playback.push(payload);
    this.onCallerAudio(payload,pcm);
  }
  audioBoundary(id,range){if(this.reviewed&&this.mode==='human')this.playback.declare(id,range);}
  audioReviewed(id,allow){if(this.reviewed&&this.mode==='human')this.playback.settle(id,allow);}
  fromOfficer(payload) {
    // Incoming filtering must not mute the officer's microphone.
    if (this.callId && this.mode !== 'ended' && (!this.textOnlyBothDirections || this.mode==='human')) this.caller({ event: 'media', media: { payload } });
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
    this.playback.clear();this.mode = 'shield'; this.epoch++;
    this.officer({ event: 'clear', epoch: this.epoch });
    if(this.textOnlyBothDirections)this.caller({event:'clear',epoch:this.epoch});
    this.events.push({ type: 'automatic_filter_enabled', source:'ai', category:decision.category,evidence:decision.evidence,callId: this.callId, at: performance.now() });
    return true;
  }
  protectManually(source,reason) {
    if(this.mode!=='human'||!['manual','analysis_error'].includes(source))return false;
    this.playback.clear();this.mode='shield';this.epoch++;this.officer({event:'clear',epoch:this.epoch});
    if(this.textOnlyBothDirections)this.caller({event:'clear',epoch:this.epoch});
    this.events.push({type:'protective_filter_enabled',source,reason,callId:this.callId,at:performance.now()});
    return true;
  }
  resume() {
    if (this.mode !== 'shield') return false;
    this.playback.clear();this.mode = 'human'; this.epoch++;
    this.officer({ event: 'clear', epoch: this.epoch });
    this.events.push({ type: 'original_audio_restored', callId: this.callId, at: performance.now() });
    return true;
  }
  end() { this.playback.close();this.mode = 'ended'; this.epoch++; }
}
