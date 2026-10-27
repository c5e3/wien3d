// Compass rose in a screen corner (settings: showCompass, compassCorner; K toggles). The card with the
// needle turns with the camera, so its red tip always points north; the letters stay upright and follow
// the language (N O S W / N E S W, i18n keys compass.n … compass.w).
const DIRS = [['n', 0], ['e', 90], ['s', 180], ['w', 270]];
const R_LETTER = 29;

function ticks() {
  let s = '';
  for (let d = 0; d < 360; d += 15) {
    if (d % 90 === 0) continue; // the letters' spokes, drawn below
    const r0 = d % 45 === 0 ? 37 : 39.5;
    s += `<line class="c-tick${d % 45 === 0 ? ' major' : ''}" y1="-${r0}" y2="-42" transform="rotate(${d})" />`;
  }
  for (const [k, d] of DIRS) s += `<line class="c-tick cardinal${k === 'n' ? ' north' : ''}" y1="-36" y2="-42.5" transform="rotate(${d})" />`;
  return s;
}

const SVG = `<svg viewBox="-50 -50 100 100" xmlns="http://www.w3.org/2000/svg">
  <circle class="c-face" r="47" />
  <circle class="c-ring" r="43.5" />
  <g class="c-card">
    ${ticks()}
    <polygon class="c-needle n1" points="0,-21 6,0 0,0" />
    <polygon class="c-needle n2" points="0,-21 -6,0 0,0" />
    <polygon class="c-needle s1" points="0,21 6,0 0,0" />
    <polygon class="c-needle s2" points="0,21 -6,0 0,0" />
    <circle class="c-pivot" r="2.6" />
  </g>
  ${DIRS.map(([k]) => `<text class="c-dir${k === 'n' ? ' north' : ''}" data-i18n="compass.${k}"></text>`).join('')}
  <path class="c-mark" d="M-4.5 -49.5 L4.5 -49.5 L0 -43 Z" />
</svg>`;

export class Compass {
  constructor(el) {
    this.el = el;
    el.innerHTML = SVG;
    this.card = el.querySelector('.c-card');
    this.letters = [...el.querySelectorAll('.c-dir')];
    this.heading = NaN;
  }

  /** tl / tr / bl / br: moves the compass into that corner's stack (top left: below the stats box). */
  setCorner(c) {
    (document.getElementById(`corner-${c}`) ?? document.getElementById('corner-tl')).appendChild(this.el);
  }

  setVisible(on) {
    this.el.classList.toggle('hidden', !on);
  }

  /** yaw: the camera's, radians, 0 = looking north, > 0 turned left (towards west). */
  update(yaw) {
    if (this.el.classList.contains('hidden')) return;
    const h = (((-yaw * 180) / Math.PI) % 360 + 360) % 360; // compass bearing, clockwise from north
    if (Math.abs(h - this.heading) < 0.05) return;
    this.heading = h;
    this.card.setAttribute('transform', `rotate(${(-h).toFixed(2)})`);
    DIRS.forEach(([, d], i) => {
      const a = ((d - h) * Math.PI) / 180;
      this.letters[i].setAttribute('x', (R_LETTER * Math.sin(a)).toFixed(2));
      this.letters[i].setAttribute('y', (-R_LETTER * Math.cos(a)).toFixed(2));
    });
  }
}
