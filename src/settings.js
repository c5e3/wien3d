import { SPEED_STEPS } from './player.js';
import { CHUNK_M } from './chunks.js';
import { t, LANGS, browserLang, locale } from './i18n.js';

// User settings, kept in this browser's localStorage. main.js applies them (onChange).
const KEY = 'wien3d.settings';
export const DEFAULTS = {
  lang: browserLang(),
  range: 3, // chunks with buildings around the player; the view reaches 3 chunks further
  resolution: 1, // share of the device pixel ratio (capped at 2)
  fov: 70,
  speed: SPEED_STEPS.indexOf(4),
  lookSens: 1,
  padInvertY: false,
  padSwapUpDown: false,
  padSwapSticks: false,
  padDrone: false,
  touchInvertX: false,
  touchInvertY: false,
  showLookRing: true,
  showStats: false,
  showCompass: true,
  showStreetNames: false,
  streetNamesHeight: 1, // m above the terrain
  compassCorner: 'tl', // tl / tr / bl / br
};

const km = (m) =>
  m < 1000 ? `${Math.round(m / 50) * 50} m` : `${(m / 1000).toLocaleString(locale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`;
export const viewDistance = (range) => (range + 3) * CHUNK_M * 1.065; // fog end; 2600 m at the default

// rendered top to bottom, each section collapsible; label / hint / section are i18n keys
const SCHEMA = [
  { key: 'lang', label: 'set.lang', type: 'select', options: LANGS },
  { section: 'set.display' },
  { key: 'showStats', label: 'set.showStats', type: 'check' },
  { key: 'showCompass', label: 'set.showCompass', type: 'check' },
  { key: 'compassCorner', label: 'set.compassCorner', type: 'select',
    options: () => Object.fromEntries(['tl', 'tr', 'bl', 'br'].map((c) => [c, t(`corner.${c}`)])) },
  { key: 'showStreetNames', label: 'set.showStreetNames', type: 'check', hint: 'set.showStreetNames.hint' },
  { key: 'streetNamesHeight', label: 'set.streetNamesHeight', type: 'range', min: 1, max: 50, step: 0.5,
    fmt: (v) => `${v.toLocaleString(locale(), { minimumFractionDigits: 1 })} m` },
  { section: 'set.graphics' },
  { key: 'range', label: 'set.range', type: 'range', min: 1, max: 7, step: 1,
    fmt: (v) => t('set.range.fmt', { a: km((v + 0.5) * CHUNK_M), b: km(viewDistance(v)) }), hint: 'set.range.hint' },
  { key: 'resolution', label: 'set.resolution', type: 'range', min: 0.4, max: 1, step: 0.1, fmt: (v) => `${Math.round(v * 100)} %`,
    hint: 'set.resolution.hint' },
  { key: 'fov', label: 'set.fov', type: 'range', min: 50, max: 100, step: 5, fmt: (v) => `${v}°` },
  { section: 'set.movement' },
  { key: 'speed', label: 'set.speed', type: 'range', min: 0, max: SPEED_STEPS.length - 1, step: 1, fmt: (v) => `×${SPEED_STEPS[v]}`, hint: 'set.speed.hint' },
  { key: 'lookSens', label: 'set.lookSens', type: 'range', min: 0.25, max: 3, step: 0.25, fmt: (v) => `×${v.toLocaleString(locale())}`, hint: 'set.lookSens.hint' },
  { section: 'set.controller' },
  { status: true },
  { key: 'padInvertY', label: 'set.padInvertY', type: 'check' },
  { key: 'padSwapUpDown', label: 'set.padSwapUpDown', type: 'check' },
  { key: 'padSwapSticks', label: 'set.padSwapSticks', type: 'check' },
  { key: 'padDrone', label: 'set.padDrone', type: 'check', hint: 'set.padDrone.hint' },
  { section: 'set.touch' },
  { key: 'touchInvertX', label: 'set.touchInvertX', type: 'check' },
  { key: 'touchInvertY', label: 'set.touchInvertY', type: 'check', hint: 'set.touchInvert.hint' },
  { key: 'showLookRing', label: 'set.showLookRing', type: 'check', hint: 'set.showLookRing.hint' },
];

function load() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

export class Settings {
  constructor({ controllerName }) {
    this.values = load();
    this.controllerName = controllerName; // () => id of the connected controller or null
    this.onChange = () => {};
    this.panel = document.getElementById('settings-panel');
    this.body = document.getElementById('settings-body');
    this.openSections = new Set(); // section keys expanded in this visit; all start collapsed
    // toggle doesn't bubble
    this.body.addEventListener('toggle', (e) => {
      const k = e.target.dataset.section;
      if (k) e.target.open ? this.openSections.add(k) : this.openSections.delete(k);
    }, true);
    document.getElementById('settings-reset').addEventListener('click', () => {
      for (const [k, v] of Object.entries(DEFAULTS)) this.set(k, v);
      this.render();
    });
    this.body.addEventListener('input', (e) => {
      const k = e.target.dataset.key;
      if (!k) return;
      const el = e.target;
      this.set(k, el.type === 'checkbox' ? el.checked : el.tagName === 'SELECT' ? el.value : Number(el.value));
      const out = this.body.querySelector(`output[data-key="${k}"]`);
      if (out) out.textContent = SCHEMA.find((r) => r.key === k).fmt(this.values[k]);
    });
  }

  get(k) {
    return this.values[k];
  }

  set(k, v) {
    if (this.values[k] === v) return;
    this.values[k] = v;
    try {
      localStorage.setItem(KEY, JSON.stringify(this.values));
    } catch {
      // private mode or storage blocked: settings just last for this visit
    }
    this.onChange(k, v);
  }

  get open() {
    return !this.panel.classList.contains('hidden');
  }

  show() {
    this.render();
    this.panel.classList.remove('hidden');
    this.statusT = setInterval(() => this.renderStatus(), 500);
  }

  hide() {
    this.panel.classList.add('hidden');
    clearInterval(this.statusT);
  }

  render() {
    let inSection = false;
    this.body.innerHTML = SCHEMA.map((r) => {
      if (r.section) {
        const html = `${inSection ? '</details>' : ''}<details data-section="${r.section}"${this.openSections.has(r.section) ? ' open' : ''}><summary>${t(r.section)}</summary>`;
        inSection = true;
        return html;
      }
      if (r.status) return '<p class="pad-status"></p>';
      const v = this.values[r.key];
      const label = t(r.label), hint = r.hint ? `<small>${t(r.hint)}</small>` : '';
      if (r.type === 'check')
        return `<label class="set-row check"><input type="checkbox" data-key="${r.key}"${v ? ' checked' : ''} /><span>${label}${hint}</span></label>`;
      if (r.type === 'select')
        return `<label class="set-row"><span>${label}</span><select data-key="${r.key}">${Object.entries(typeof r.options === 'function' ? r.options() : r.options)
          .map(([k, name]) => `<option value="${k}"${k === v ? ' selected' : ''}>${name}</option>`)
          .join('')}</select></label>`;
      return `<label class="set-row"><span>${label}${hint}</span>
        <input type="range" data-key="${r.key}" min="${r.min}" max="${r.max}" step="${r.step}" value="${v}" />
        <output data-key="${r.key}">${r.fmt(v)}</output></label>`;
    }).join('') + (inSection ? '</details>' : '');
    this.renderStatus();
  }

  renderStatus() {
    const el = this.body.querySelector('.pad-status');
    if (!el) return;
    const id = this.controllerName();
    const text = id ? t('set.pad.ok', { id }) : t('set.pad.none');
    if (el.textContent !== text) {
      el.textContent = text;
      el.classList.toggle('ok', !!id);
    }
  }
}
