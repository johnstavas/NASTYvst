import { useState, useRef, useEffect } from 'react';

// Generic preset dropdown — works with any plugin's color scheme.
// Props:
//   presets      — array of { name, ...params }
//   activePreset — currently active preset name (or null)
//   onSelect     — called with the full preset object
//   colors       — { bg, text, textDim, border, hoverBg } for theming
export default function PresetSelector({ presets, activePreset, onSelect, colors = {} }) {
  const [open, setOpen] = useState(false);
  const [openUp, setOpenUp] = useState(false);
  const btnRef = useRef(null);
  const dropRef = useRef(null);

  const bg      = colors.bg      || '#1a1a2a';
  const text    = colors.text    || '#f0ece0';
  const textDim = colors.textDim || 'rgba(240,236,224,0.5)';
  const border  = colors.border  || 'rgba(240,236,224,0.15)';
  const hoverBg = colors.hoverBg || 'rgba(240,236,224,0.12)';
  const activeBg = colors.activeBg || 'rgba(240,236,224,0.08)';

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (btnRef.current && !btnRef.current.contains(e.target) &&
          dropRef.current && !dropRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleToggle = () => {
    if (!open && btnRef.current) {
      // Check if there's enough space below; if not, open upward
      const rect = btnRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      setOpenUp(spaceBelow < 150);
    }
    setOpen(!open);
  };

  return (
    <div ref={btnRef} style={{ position: 'relative', userSelect: 'none', zIndex: 200 }}>
      <button onClick={handleToggle} style={{
        fontSize: 7, fontWeight: 700, fontFamily: 'system-ui, -apple-system, Arial, sans-serif',
        letterSpacing: '0.1em', padding: '3px 10px', borderRadius: 3,
        background: bg, color: text,
        border: `1.5px solid ${open ? border : bg}`, cursor: 'pointer',
        display: 'flex', alignItems: 'center', gap: 4,
        minWidth: 76, justifyContent: 'space-between',
        transition: 'border-color 0.15s',
      }}>
        <span>{activePreset || 'PRESETS'}</span>
        <span style={{ fontSize: 5.5, opacity: 0.6 }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div ref={dropRef} style={{
          position: 'absolute',
          ...(openUp
            ? { bottom: '100%', left: 0, marginBottom: 2 }
            : { top: '100%', left: 0, marginTop: 2 }),
          background: bg, border: `1.5px solid ${border}`,
          borderRadius: 3, zIndex: 300, minWidth: 100, overflow: 'hidden',
          boxShadow: '0 4px 16px rgba(0,0,0,0.6)',
          maxHeight: 180, overflowY: 'auto',
        }}>
          {presets.map(p => (
            <div key={p.name} onClick={() => { onSelect(p); setOpen(false); }} style={{
              fontSize: 7, fontWeight: 600, fontFamily: 'system-ui, -apple-system, Arial, sans-serif',
              letterSpacing: '0.08em', padding: '5px 10px', cursor: 'pointer',
              color: activePreset === p.name ? text : textDim,
              background: activePreset === p.name ? activeBg : 'transparent',
              transition: 'all 0.1s ease',
              whiteSpace: 'nowrap',
            }}
            onMouseEnter={e => e.currentTarget.style.background = hoverBg}
            onMouseLeave={e => e.currentTarget.style.background = activePreset === p.name ? activeBg : 'transparent'}
            >{p.name}</div>
          ))}
        </div>
      )}
    </div>
  );
}
