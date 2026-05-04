/* global React, ReactDOM */
const { useState, useEffect, useRef } = React;

const Wordmark = () => (
  <div className="wordmark">
    <div className="wordmark__name">Garra</div>
    <div className="wordmark__sub">claw · pokémon · 2026</div>
  </div>
);

const ThemeToggle = ({ dark, onToggle }) => (
  <button className="chip chip--circle holo-rim spec" onClick={onToggle} aria-label="Toggle theme">
    {dark ? '☀' : '☾'}
  </button>
);

const Wallet = () => (
  <button className="chip holo-rim spec">Wallet</button>
);

const Play = ({ glossMode }) => {
  const ref = useRef(null);
  // Track: element-local cursor (--lmx/--lmy) AND gradient angle (--gangle)
  // that points from element center toward the document-space cursor.
  // The angle uses CSS gradient convention where 0deg = upward, so we add 90°
  // to atan2 (which is from +X) and reverse Y because screen Y is flipped.
  useEffect(() => {
    let raf = null;
    const update = (cx, cy) => {
      const el = ref.current; if (!el) return;
      const r = el.getBoundingClientRect();
      el.style.setProperty('--lmx', `${cx - r.left}px`);
      el.style.setProperty('--lmy', `${cy - r.top}px`);
      const ex = r.left + r.width / 2;
      const ey = r.top + r.height / 2;
      const dx = cx - ex, dy = cy - ey;
      // CSS linear-gradient angle: 0deg = up, 90deg = right, 180deg = down.
      // We want the BRIGHT START of the gradient to be on the CURSOR side.
      // atan2(dx, -dy) returns 0 when cursor is straight up — exactly the
      // CSS "0deg = up" convention — so use it directly.
      const ang = Math.atan2(dx, -dy) * 180 / Math.PI;
      el.style.setProperty('--gangle', `${ang}deg`);
    };
    const onMove = (e) => {
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = null; update(e.clientX, e.clientY); });
    };
    window.addEventListener('pointermove', onMove);
    return () => window.removeEventListener('pointermove', onMove);
  }, []);
  const cls = glossMode === 'linear' ? 'play--gloss-linear'
            : glossMode === 'radial' ? 'play--gloss-radial' : '';
  return (
    <button className={`play holo-rim spec ${cls}`} ref={ref}>
      <span className="play__inner-gloss" />
      <span className="play__sweep" />
      <span className="play__label">PLAY</span>
    </button>
  );
};

const Rates = () => (
  <div className="glass holo-rim spec rates">
    <div className="rates__tag">Drop rates</div>
    <div className="rates__rows">
      <div className="rates__row">
        <span className="sphere sphere--common" />
        <span className="rates__name">Common</span>
        <span className="rates__odds">70%</span>
      </div>
      <div className="rates__row">
        <span className="sphere sphere--rare" />
        <span className="rates__name">Rare</span>
        <span className="rates__odds">25%</span>
      </div>
      <div className="rates__row">
        <span className="sphere sphere--chase" />
        <span className="rates__name">Chase</span>
        <span className="rates__odds">5%</span>
      </div>
    </div>
  </div>
);

const Rules = ({ onOpen }) => (
  <button className="rules holo-rim spec" onClick={onOpen}>How to play</button>
);

const RulesModal = ({ open, onClose }) => {
  if (!open) return null;
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="glass holo-rim modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal__close" onClick={onClose} aria-label="Close">✕</button>
        <div className="rates__tag">Quick start</div>
        <h2>How to play</h2>
        <ol>
          <li>Connect a wallet to load USDC.</li>
          <li>Drive the claw — WASD or arrows, space to grab.</li>
          <li>Lift a sphere → score a Pokémon booster.</li>
          <li>Cash out instantly, or vault it for shipment within 30 days.</li>
        </ol>
      </div>
    </div>
  );
};

const Video = () => (
  <div className="video">
    <div className="video__frame">
      <div className="video__screen">
        <div className="video__noise" />
        <div className="video__vignette" />
        <div className="video__inner">
          <div className="video__error">Error: stream not found, retrying in some seconds</div>
        </div>
      </div>
      <div className="video__rim spec" />
      <div className="video__live">
        <span className="video__live__dot" />
        LIVE
      </div>
      <button className="video__expand" aria-label="Fullscreen">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M2 5V2h3M9 2h3v3M12 9v3H9M5 12H2V9" />
        </svg>
      </button>
    </div>
  </div>
);

/* Tweaks ------------------------------------------------- */

const DEFAULTS = /*EDITMODE-BEGIN*/{
  "colorTemp": "pearl",
  "accent": "iris",
  "frost": 1,
  "dark": false,
  "anim": true,
  "typeScale": 1,
  "rim": 0.85,
  "spec": 1,
  "glossMode": "linear"
}/*EDITMODE-END*/;

const TEMPS = {
  silver:    { p1:'#ebe7df', p2:'#d4d0c8', p3:'#bfbcb4', forceDark:false },
  pearl:     { p1:'#efe9da', p2:'#d8d2c2', p3:'#c8c2b2', forceDark:false },
  champagne: { p1:'#f0e6d2', p2:'#e0d4ba', p3:'#cabd9e', forceDark:false },
  black:     { p1:'#2a2520', p2:'#1c1815', p3:'#100e0c', forceDark:true  },
};

const ACCENTS = {
  iris:   'oklch(62% 0.14 320)',
  violet: 'oklch(58% 0.14 280)',
  cyan:   'oklch(62% 0.13 200)',
  rose:   'oklch(62% 0.14 25)',
  lime:   'oklch(72% 0.16 130)',
};

function App() {
  const [t, setTweak] = window.useTweaks(DEFAULTS);
  const [rulesOpen, setRulesOpen] = useState(false);

  const temp = TEMPS[t.colorTemp] || TEMPS.pearl;
  const dark = t.dark || temp.forceDark;
  const accent = ACCENTS[t.accent] || ACCENTS.iris;

  useEffect(() => {
    document.body.classList.toggle('dark', dark);
    document.body.classList.toggle('no-anim', !t.anim);
  }, [dark, t.anim]);

  // Global specular tracker — write --spec-angle + --spec-strength on every
  // .spec element. Synchronous (no rAF) for max reliability; the work is
  // tiny (6 elements × getBoundingClientRect).
  useEffect(() => {
    const update = (cx, cy) => {
      const els = document.querySelectorAll('.spec');
      for (let i = 0; i < els.length; i++) {
        const el = els[i];
        const r = el.getBoundingClientRect();
        const ex = r.left + r.width / 2;
        const ey = r.top + r.height / 2;
        const dx = cx - ex, dy = cy - ey;
        const ang = Math.atan2(dy, dx) * 180 / Math.PI + 90;
        const diag = Math.hypot(r.width, r.height) / 2;
        const dist = Math.hypot(dx, dy);
        const near = diag * 1.2;
        const far  = diag * 2.8;
        let strength = 1 - (dist - near) / (far - near);
        if (strength < 0) strength = 0;
        if (strength > 1) strength = 1;
        el.style.setProperty('--spec-angle', ang + 'deg');
        el.style.setProperty('--spec-strength', strength.toFixed(3));
      }
    };
    const onMove = (e) => update(e.clientX, e.clientY);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('mousemove', onMove);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('mousemove', onMove);
    };
  }, []);

  const cssVars = {
    '--paper-1': temp.p1,
    '--paper-2': temp.p2,
    '--paper-3': temp.p3,
    '--accent': accent,
    '--frost': t.frost,
    '--type-scale': t.typeScale,
    '--rim-opacity': t.rim,
    '--spec-intensity': t.spec,
  };

  return (
    <>
      <style>{`
        :root { ${Object.entries(cssVars).map(([k,v]) => `${k}: ${v};`).join(' ')} }
        body { background: ${temp.p2}; }
      `}</style>

      <div className="root">
        <div className="rail">
          <div className="head">
            <ThemeToggle dark={dark} onToggle={() => setTweak('dark', !t.dark)} />
            <Wordmark />
            <Wallet />
          </div>

          <Play glossMode={t.glossMode} />

          <div className="queue">No players in queue.</div>

          <div className="grow" />

          <div className="divider" />

          <Rates />
          <Rules onOpen={() => setRulesOpen(true)} />
        </div>

        <div className="stage">
          <Video />
        </div>
      </div>

      <RulesModal open={rulesOpen} onClose={() => setRulesOpen(false)} />

      <window.TweaksPanel title="Tweaks">
        <window.TweakSection label="Atmosphere" />
        <window.TweakSelect
          label="Color temp"
          value={t.colorTemp}
          onChange={(v) => setTweak('colorTemp', v)}
          options={[
            { value: 'silver',    label: 'Cool silver' },
            { value: 'pearl',     label: 'Warm pearl' },
            { value: 'champagne', label: 'Champagne' },
            { value: 'black',     label: 'Space black' },
          ]}
        />
        <window.TweakSelect
          label="Accent"
          value={t.accent}
          onChange={(v) => setTweak('accent', v)}
          options={[
            { value: 'iris',   label: 'Iris' },
            { value: 'violet', label: 'Violet' },
            { value: 'cyan',   label: 'Cyan' },
            { value: 'rose',   label: 'Rose' },
            { value: 'lime',   label: 'Lime' },
          ]}
        />
        <window.TweakToggle
          label="Dark mode"
          value={t.dark}
          onChange={(v) => setTweak('dark', v)}
        />

        <window.TweakSection label="Surfaces" />
        <window.TweakSlider
          label="Frost"
          value={t.frost}
          min={0} max={2} step={0.05}
          onChange={(v) => setTweak('frost', v)}
        />
        <window.TweakSlider
          label="Holo rim"
          value={t.rim}
          min={0} max={1} step={0.05}
          onChange={(v) => setTweak('rim', v)}
        />
        <window.TweakSlider
          label="Specular"
          value={t.spec}
          min={0} max={1.5} step={0.05}
          onChange={(v) => setTweak('spec', v)}
        />
        <window.TweakRadio
          label="Play gloss"
          value={t.glossMode}
          options={['static', 'linear', 'radial']}
          onChange={(v) => setTweak('glossMode', v)}
        />
        <window.TweakSlider
          label="Type scale"
          value={t.typeScale}
          min={0.85} max={1.25} step={0.01}
          onChange={(v) => setTweak('typeScale', v)}
        />
        <window.TweakToggle
          label="Animations"
          value={t.anim}
          onChange={(v) => setTweak('anim', v)}
        />
      </window.TweaksPanel>
    </>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
