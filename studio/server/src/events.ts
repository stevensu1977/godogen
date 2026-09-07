import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import type {StudioEvent, StudioEventInput } from '@godogen/shared';

/** Append-only per-run event log: JSONL on disk, in-memory mirror for replay, EventEmitter for live fans. */
export class EventLog {
  private events: StudioEvent[] = [];
  private emitter = new EventEmitter();
  constructor(readonly file: string, readonly runId: string) {
    this.emitter.setMaxListeners(0);
    if (existsSync(file)) {
      for (const line of readFileSync(file, 'utf-8').split('\n')) {
        if (!line.trim()) continue;
        try { this.events.push(JSON.parse(line)); } catch { /* skip torn line */ }
      }
    }
  }
  get seq() { return this.events.length ? this.events[this.events.length - 1].seq : 0; }
  all() { return this.events; }
  after(seq: number) { return this.events.filter(e => e.seq > seq); }
  append(partial: StudioEventInput): StudioEvent {
    const ev = { ...partial, seq: this.seq + 1, runId: this.runId, ts: new Date().toISOString() } as unknown as StudioEvent;
    this.events.push(ev);
    appendFileSync(this.file, JSON.stringify(ev) + '\n');
    this.emitter.emit('event', ev);
    return ev;
  }
  subscribe(fn: (ev: StudioEvent) => void) { this.emitter.on('event', fn); return () => this.emitter.off('event', fn); }
}
