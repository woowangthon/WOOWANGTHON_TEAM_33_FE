// One partial classification in flight per call. Coalesce deltas, never gate on vocabulary.
export class LiveSafety {
  constructor({check, onResult, onError, intervalMs = 1200, now = () => performance.now()}) {
    if (!Number.isFinite(intervalMs) || intervalMs < 100) throw new Error('Invalid_safety_interval');
    Object.assign(this, {check, onResult, onError, intervalMs, now});
    this.queue = new Map(); this.last = new WeakMap(); this.lastStarted = -Infinity;
    this.closed = false; this.running = null; this.timer = null;
  }
  enqueue(turn) {
    const text = turn.partial.trim();
    if (this.closed || turn.shielded || turn.finalReview || !text || this.last.get(turn) === text) return;
    this.queue.set(turn, text);
    this.schedule();
  }
  schedule() {
    if (this.closed || this.running || this.timer || !this.queue.size) return;
    const remaining = Math.max(this.intervalMs - (this.now() - this.lastStarted),(this.retryAt||0)-this.now());
    if (remaining > 0) this.timer = setTimeout(() => {this.timer = null; this.schedule();}, remaining);
    else this.run();
  }
  run() {
    const [turn, text] = this.queue.entries().next().value;
    this.queue.delete(turn);
    if (turn.shielded || turn.finalReview) return this.schedule();
    this.last.set(turn, text); this.lastStarted = this.now();const currentText=turn.currentText||text;
    const controller = new AbortController();
    // Install running before invoking check, even when a test/provider resolves synchronously.
    const running = {turn, controller}; this.running = running;
    running.promise = Promise.resolve().then(() => this.check(text, {partial: true, signal: controller.signal,currentText}))
      .then(result => {
        if(result.directAbuse&&(!result.evidence||!turn.partial.includes(result.evidence)||(result.targetEvidence&&!turn.partial.includes(result.targetEvidence))))return;
        if (!this.closed && !controller.signal.aborted && !turn.finalReview && !turn.shielded) this.onResult(turn, result, text);
      }).catch(error => {
        if (!this.closed && !controller.signal.aborted && !turn.finalReview){
          if((error?.status===429&&!/insufficient_quota/.test(error.message))||error?.message==='Gemini_HTTP_429'){
            this.retryAt=this.now()+Math.max(1000,Math.min(60000,error.retryAfterMs||30000));
            this.last.delete(turn);this.queue.set(turn,turn.partial.trim());
          }
          this.onError(error);
        }
      }).finally(() => {this.running = null; this.schedule();});
  }
  finish(turn) {
    turn.finalReview = true; this.queue.delete(turn);
    if (this.running?.turn === turn) this.running.controller.abort();
  }
  close() {
    this.closed = true; clearTimeout(this.timer); this.timer = null; this.queue.clear();
    this.running?.controller.abort();
  }
}
