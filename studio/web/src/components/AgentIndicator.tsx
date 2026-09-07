import type { Phase } from '@goscene/shared';
import { PHASE_LABEL } from '../lib/format';

/**
 * The "agent at work" duck. One SVG, per-phase CSS animation classes (see styles.css). Driven only by
 * real `phase` events; there is no synthetic progress.
 */
export function Duck({ phase }: { phase: Phase }) {
  return (
    <div className={`duck-wrap ${phase}`} title={PHASE_LABEL[phase]} aria-label={PHASE_LABEL[phase]} role="img">
      <svg width="46" height="42" viewBox="0 0 46 42">
        {phase === 'capturing' && <rect className="flash" x="-4" y="-4" width="54" height="50" fill="#fff" opacity="0" rx="6" />}
        <g className="duck">
          {/* body */}
          <ellipse cx="20" cy="30" rx="15" ry="9.5" fill="#f2c14e" />
          <ellipse cx="14" cy="27" rx="7" ry="3.8" fill="#f7d071" opacity="0.7" />
          {/* wing */}
          <path className="wing" d="M12 26 q7 -4 14 2 q-7 6 -14 -2z" fill="#e0ab35" />
          {/* head */}
          <g className="head">
            <circle cx="30" cy="16" r="8" fill="#f2c14e" />
            <polygon points="37,15 45,17.5 37,20" fill="#f5792a" />
            <circle cx="33" cy="14" r="1.6" fill="#1a1405" />
            <circle cx="33.5" cy="13.5" r="0.5" fill="#fff" />
          </g>
          {/* feet */}
          <path d="M14 39 l3 -3 l3 3z M22 39 l3 -3 l3 3z" fill="#f5792a" />
        </g>
      </svg>
      {phase === 'thinking' && <span className="fx dots" style={{ top: -4, right: -2 }}><span /><span /><span /></span>}
      {phase === 'reading' && <span className="fx page" style={{ top: 0, right: -6 }}>📄</span>}
      {phase === 'command' && <span className="fx cursor" style={{ top: 2, right: -6 }}>▍</span>}
      {phase === 'writing' && <span className="fx" style={{ top: 0, right: -6 }}>✏️</span>}
      {phase === 'blender' && <span className="fx cube" style={{ top: 14, left: 17 }}>🟧</span>}
      {phase === 'godot' && <span className="fx gear" style={{ top: -4, right: -6 }}>⚙️</span>}
      {phase === 'capturing' && <span className="fx rec" style={{ top: -2, right: -6, color: 'var(--ph-capturing)', fontSize: 12 }}>● REC</span>}
      {phase === 'reviewing' && <span className="fx lens" style={{ top: 12, left: 6 }}>🔍</span>}
      {phase === 'waiting_input' && <span className="fx q" style={{ top: -6, right: -2, color: 'var(--accent)', fontWeight: 800, fontSize: 15 }}>?</span>}
      {phase === 'done' && <span className="fx check" style={{ top: -4, right: -6, color: 'var(--ok)', fontWeight: 800, fontSize: 15 }}>✓</span>}
      {phase === 'failed' && <span className="fx" style={{ top: -2, right: -6, color: 'var(--err)', fontWeight: 800, fontSize: 14 }}>✕</span>}
    </div>
  );
}

export function AgentIndicator({ phase, detail }: { phase: Phase; detail?: string }) {
  return (
    <div className="agent-status" style={{ ['--ph' as string]: `var(--ph-${phase})` }}>
      <Duck phase={phase} />
      <div className="label">
        <span className="phase-name">{PHASE_LABEL[phase]}</span>
        {detail && <span className="phase-detail" title={detail}>{detail}</span>}
      </div>
    </div>
  );
}
