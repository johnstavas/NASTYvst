// BrickZoomView — Step 1 of sandbox core (see memory/sandbox_core_scope.md).
//
// This is the "zoomed-in" view of a single brick. In v1 every brick is
// still a hand-coded worklet, so this view shows an honest placeholder
// explaining that the brick's internal graph hasn't been published to
// the sandbox yet. The *interaction pattern* is what matters at this
// stage — double-click brick → canvas swaps to this view → back button
// returns to chain. Audio behavior is 100% unchanged.
//
// Step 2 will replace the placeholder body with an actual op-graph
// canvas once the op registry + graph.json + first sandbox-native brick
// exist. Nothing else in this component should need to change at that
// point beyond swapping <PlaceholderBody/> for <OpGraphCanvas/>.

import React, { useEffect, useState } from 'react';
import OpGraphCanvas from './sandbox/OpGraphCanvas';
import { getMockGraphForBrick } from './sandbox/mockGraphs';
import { getLiveGraph, subscribeLiveGraph } from './sandbox/liveGraphStore';
import { OPS } from './sandbox/opRegistry';

/** Type → display label. Mirrors the inline lookup in main.jsx chain-pill
 *  rendering. Kept local for now — will move to a shared util when the
 *  sandbox op registry lands. */
const BRICK_LABELS = {
  amp: 'Amp', distortion: 'Distortion', modulation: 'Modulation', vocal: 'Vocal',
  mixbus: 'Mix Bus', reverb: 'Reverb', scope: 'Scope', neve: '1073 Neve',
  iron1073: 'Iron 1073', nastyneve: 'Nasty Neve', tape: '424 Tape',
  spring: 'Wabble Spring', spring2: 'Spring Reverb', eightOhEight: '808 Kick',
  lofiLoofy: 'Lofi Loofy', flapjackman: 'Flap Jack Man', tapedelay: 'Tape Delay',
  analogglue: 'Analog Glue', la2a: 'LA-2A', shagatron: 'Shagatron',
  flanger: 'Flanger', phaser: 'Phaser', gluesmash: 'GlueSmash',
  bassmind: 'BassMind', echoform: 'EchoForm', drift: 'Drift',
  ampless: 'Ampless', finisher: 'Finisher', reactor: 'Reactor',
  splitdrive: 'SplitDrive', smoother: 'Smoother', playbox: 'PlayBox',
  pitchshift: 'Pitch Shifter', vocallock: 'VocalLock', deharsh: 'DeHarsh',
  vibemic: 'VibeMic', phraserider: 'PhraseRider', airlift: 'AirLift',
  character: 'CharacterBox', gravity: 'Gravity', focusreverb: 'Focus Reverb',
  nearfar: 'Near/Far', morphreverb: 'MorphReverb',
  transientreverb: 'TransientVerb', smear: 'Smear', orbit: 'Orbit',
  platex: 'Plate-X', reverbbus: 'ReverbBus', drumbus: 'Panther Buss',
  manchild: 'ManChild', simplereverb: 'Simple Reverb',
  sandboxToy:   'SandboxToy',
  filterFx:     'FilterFX',
  echoformLite: 'EchoformLite',
  modDuck:      'ModDuck',
};

const brickLabel = (type) => BRICK_LABELS[type] || type || 'Unknown';

/** The placeholder body shown for every brick that has no mock graph yet. */
function PlaceholderBody({ instance }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', gap: 18, padding: '64px 32px',
      minHeight: 360,
      color: 'rgba(255,255,255,0.45)',
      textAlign: 'center',
    }}>
      {/* Stylized "closed brick" glyph — three stacked rounded boxes */}
      <svg width="64" height="64" viewBox="0 0 64 64" fill="none"
           style={{ opacity: 0.35 }}>
        <rect x="8"  y="10" width="48" height="12" rx="3"
              stroke="rgba(255,255,255,0.6)" strokeWidth="1.5" />
        <rect x="8"  y="26" width="48" height="12" rx="3"
              stroke="rgba(255,255,255,0.6)" strokeWidth="1.5" />
        <rect x="8"  y="42" width="48" height="12" rx="3"
              stroke="rgba(255,255,255,0.6)" strokeWidth="1.5" />
      </svg>

      <div style={{
        fontSize: 11, letterSpacing: '0.22em', textTransform: 'uppercase',
        color: 'rgba(255,255,255,0.55)', fontWeight: 600,
      }}>
        Opaque brick
      </div>

      <div style={{
        fontSize: 13, lineHeight: 1.6, maxWidth: 520,
        color: 'rgba(255,255,255,0.45)',
      }}>
        <strong style={{ color: 'rgba(255,255,255,0.7)' }}>{brickLabel(instance.type)}</strong>{' '}
        is a hand-coded brick. Its internal DSP graph hasn't been published
        to the sandbox yet, so there's nothing to show inside here.
      </div>

      <div style={{
        fontSize: 10, lineHeight: 1.5, maxWidth: 460,
        color: 'rgba(255,255,255,0.3)',
        padding: '10px 14px', borderRadius: 6,
        background: 'rgba(255,255,255,0.02)',
        border: '1px dashed rgba(255,255,255,0.08)',
      }}>
        Future work: once this brick is decomposed into ops (delay · feedback ·
        tone filter · mix · …) you'll see and rewire its internal graph right
        here. Track progress in <code>memory/sandbox_core_scope.md</code>.
      </div>

      <button
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          // Back-nav is driven by the parent via Esc or the breadcrumb;
          // expose a secondary button here for discoverability.
          window.dispatchEvent(new CustomEvent('brick-zoom:close'));
        }}
        style={{
          marginTop: 4,
          fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase',
          fontWeight: 600,
          padding: '8px 18px', borderRadius: 6,
          background: 'rgba(255,255,255,0.05)',
          border: '1px solid rgba(255,255,255,0.15)',
          color: 'rgba(255,255,255,0.65)',
          cursor: 'pointer',
        }}>
        ← Back to chain
      </button>
    </div>
  );
}

/** Op palette — visible parts bin next to the graph. Read-only for now
 *  (authoring mutation lands with Step 2d / the real graph-editing pass);
 *  this just makes the full op catalog visible when the user zooms into
 *  a brick so they can see what's available. Highlights ops already
 *  present in the current graph. */
function OpPalette({ graph }) {
  const inUse = new Set((graph?.nodes || []).map(n => n.op));
  const entries = Object.values(OPS);
  return (
    <div style={{
      width: 200, flexShrink: 0,
      borderLeft: '1px solid rgba(255,255,255,0.06)',
      background: 'rgba(0,0,0,0.25)',
      display: 'flex', flexDirection: 'column',
      maxHeight: 520, overflow: 'hidden',
    }}>
      <div style={{
        padding: '10px 12px',
        fontSize: 9, letterSpacing: '0.28em', textTransform: 'uppercase',
        color: 'rgba(255,255,255,0.45)', fontWeight: 700,
        borderBottom: '1px solid rgba(255,255,255,0.05)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <span>Op Palette</span>
        <span style={{
          fontSize: 7, letterSpacing: '0.18em',
          padding: '2px 5px', borderRadius: 3,
          color: 'rgba(255,200,120,0.7)',
          background: 'rgba(255,200,120,0.08)',
          border: '1px solid rgba(255,200,120,0.18)',
        }}>read-only</span>
      </div>
      <div style={{ overflow: 'auto', padding: '6px 0' }}>
        {entries.map(op => {
          const used = inUse.has(op.id);
          const nIn  = op.ports.inputs.length;
          const nOut = op.ports.outputs.length;
          return (
            <div key={op.id}
              title={op.description}
              style={{
                padding: '8px 12px',
                borderLeft: used ? '2px solid rgba(127,255,143,0.6)' : '2px solid transparent',
                background: used ? 'rgba(127,255,143,0.04)' : 'transparent',
                cursor: 'default',
              }}>
              <div style={{
                display: 'flex', alignItems: 'baseline', gap: 6,
                fontSize: 11, fontWeight: 600,
                color: used ? 'rgba(127,255,143,0.9)' : 'rgba(255,255,255,0.75)',
              }}>
                {op.label}
                <span style={{
                  fontSize: 8, letterSpacing: '0.1em',
                  color: 'rgba(255,255,255,0.3)', fontWeight: 400,
                }}>
                  {nIn}→{nOut}
                </span>
              </div>
              <div style={{
                fontSize: 9, lineHeight: 1.4, marginTop: 2,
                color: 'rgba(255,255,255,0.38)',
              }}>
                {op.description}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Body picker. Subscribes to the live-graph store for sandbox-native
 *  bricks so the view re-renders when the parent's knobs move. Falls
 *  back to the static mock for hand-coded bricks (or the opaque
 *  placeholder when no mock exists). Graph view gets the op palette;
 *  opaque-brick view doesn't (nothing to highlight against). */
function ZoomBody({ instance }) {
  const [liveGraph, setLive] = useState(() => getLiveGraph(instance.id));
  useEffect(() => {
    const unsub = subscribeLiveGraph(instance.id, setLive);
    setLive(getLiveGraph(instance.id)); // pick up latest in case it changed during mount
    return unsub;
  }, [instance.id]);

  const graph = liveGraph || getMockGraphForBrick(instance.type);
  if (!graph) return <PlaceholderBody instance={instance} />;
  return (
    <div style={{ display: 'flex', alignItems: 'stretch' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <OpGraphCanvas graph={graph} />
      </div>
      <OpPalette graph={graph} />
    </div>
  );
}

export default function BrickZoomView({ instance, onClose }) {
  // Esc closes the zoom view. Also listen for the custom event fired by the
  // placeholder's back button so the button doesn't need to know about
  // onClose prop wiring.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    const onEvt = () => onClose?.();
    window.addEventListener('keydown', onKey);
    window.addEventListener('brick-zoom:close', onEvt);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('brick-zoom:close', onEvt);
    };
  }, [onClose]);

  if (!instance) return null;

  return (
    <div style={{
      // Wide canvas — bricks will get dense once they have 10+ ops.
      // Cap at 1400 so the SVG doesn't stretch ridiculously on ultrawides;
      // the inner viewBox scales to fill via width:100%.
      width: '100%', maxWidth: 1400,
      margin: '0 auto',
      borderRadius: 12,
      background: 'rgba(10,14,18,0.85)',
      border: '1px solid rgba(255,255,255,0.08)',
      overflow: 'hidden',
      boxShadow: '0 12px 48px rgba(0,0,0,0.5)',
    }}>
      {/* Breadcrumb header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 14px',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        background: 'rgba(255,255,255,0.02)',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          fontSize: 10, letterSpacing: '0.22em', textTransform: 'uppercase',
        }}>
          <button
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onClose?.(); }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.08)';
              e.currentTarget.style.color = 'rgba(255,255,255,0.9)';
              e.currentTarget.style.borderColor = 'rgba(255,255,255,0.25)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.03)';
              e.currentTarget.style.color = 'rgba(255,255,255,0.6)';
              e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)';
            }}
            style={{
              fontSize: 10, letterSpacing: '0.22em', fontWeight: 600,
              color: 'rgba(255,255,255,0.6)',
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 4,
              cursor: 'pointer',
              padding: '4px 10px',
              display: 'inline-flex', alignItems: 'center', gap: 4,
              transition: 'all 0.12s',
            }}
            title="Back to chain (Esc)"
          >
            <span style={{ fontSize: 12, lineHeight: 1 }}>←</span>
            Chain
          </button>
          <span style={{ color: 'rgba(255,255,255,0.25)' }}>›</span>
          <span style={{ color: 'rgba(255,255,255,0.75)', fontWeight: 600 }}>
            {brickLabel(instance.type)}
          </span>
          <span style={{
            marginLeft: 8, fontSize: 8, letterSpacing: '0.22em',
            padding: '2px 6px', borderRadius: 3,
            color: 'rgba(255,200,120,0.75)',
            background: 'rgba(255,200,120,0.08)',
            border: '1px solid rgba(255,200,120,0.2)',
          }}>
            inside view · preview
          </span>
        </div>
        <button
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onClose?.(); }}
          className="w-5 h-5 rounded-full text-[11px]"
          style={{
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.12)',
            color: 'rgba(255,255,255,0.55)',
            cursor: 'pointer',
          }}
          title="Close (Esc)"
        >
          ×
        </button>
      </div>

      {/* Body — op-graph mock if we've drawn one for this brick type,
          otherwise the opaque-brick placeholder. When the real Step 2
          pipeline lands, both branches collapse into <OpGraphCanvas/>
          driven by graph.json. */}
      <ZoomBody instance={instance} />
    </div>
  );
}
