import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const outDir = join(process.cwd(), 'client/src/assets/orc-theme');
mkdirSync(outDir, { recursive: true });

function save(name, svg) {
  writeFileSync(join(outDir, name), svg.trim() + '\n', 'utf8');
  console.log(`generated ${name}`);
}

function svgDoc({ width, height, body, defs = '' }) {
  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none">
${defs}
${body}
</svg>`;
}

function cardTemplate({ left = '5', right = '5', body = '', tint = '#fffaf1', frame = '#111111' }) {
  const width = 360;
  const height = 480;
  return svgDoc({
    width,
    height,
    defs: `
  <filter id="paperShadow" x="-20%" y="-20%" width="140%" height="140%">
    <feDropShadow dx="0" dy="6" stdDeviation="4" flood-color="#000" flood-opacity="0.23"/>
  </filter>`,
    body: `
  <rect x="10" y="10" width="340" height="460" rx="26" fill="${tint}" stroke="#f0e6d2" stroke-width="3" filter="url(#paperShadow)"/>
  <path d="M40 52 L322 52" stroke="${frame}" stroke-width="8" stroke-linecap="round"/>
  <path d="M42 52 L42 426" stroke="${frame}" stroke-width="8" stroke-linecap="round"/>
  <path d="M322 52 L322 426" stroke="${frame}" stroke-width="8" stroke-linecap="round"/>
  <path d="M42 426 L322 426" stroke="${frame}" stroke-width="8" stroke-linecap="round"/>
  <text x="36" y="45" font-size="48" font-family="'Comic Sans MS', 'Trebuchet MS', sans-serif" fill="${frame}" font-weight="700">${left}</text>
  <text x="302" y="466" font-size="48" font-family="'Comic Sans MS', 'Trebuchet MS', sans-serif" fill="${frame}" font-weight="700">${right}</text>
  <g transform="translate(72 110)">
${body}
  </g>`
  });
}

const bodyAttack = `
    <ellipse cx="106" cy="204" rx="76" ry="84" fill="#88b972" stroke="#111" stroke-width="8"/>
    <ellipse cx="74" cy="132" rx="38" ry="42" fill="#7cae64" stroke="#111" stroke-width="8"/>
    <ellipse cx="144" cy="132" rx="38" ry="42" fill="#7cae64" stroke="#111" stroke-width="8"/>
    <ellipse cx="106" cy="110" rx="56" ry="62" fill="#9ad181" stroke="#111" stroke-width="8"/>
    <ellipse cx="88" cy="108" rx="11" ry="14" fill="#fff" stroke="#111" stroke-width="5"/>
    <ellipse cx="126" cy="108" rx="11" ry="14" fill="#fff" stroke="#111" stroke-width="5"/>
    <circle cx="88" cy="110" r="4" fill="#111"/>
    <circle cx="126" cy="110" r="4" fill="#111"/>
    <path d="M86 138 Q106 154 126 138" stroke="#111" stroke-width="7" stroke-linecap="round" fill="none"/>
    <path d="M159 172 L216 128 L230 152 L176 194 Z" fill="#bc8550" stroke="#111" stroke-width="8" stroke-linejoin="round"/>
    <path d="M214 126 L244 118 L240 172 L212 162 Z" fill="#d0d3da" stroke="#111" stroke-width="8" stroke-linejoin="round"/>
    <path d="M164 174 L126 214" stroke="#111" stroke-width="8" stroke-linecap="round"/>
`;

const bodyDefense = `
    <ellipse cx="106" cy="204" rx="78" ry="84" fill="#9bcf89" stroke="#111" stroke-width="8"/>
    <ellipse cx="106" cy="114" rx="54" ry="60" fill="#aee79b" stroke="#111" stroke-width="8"/>
    <ellipse cx="88" cy="112" rx="12" ry="14" fill="#fff" stroke="#111" stroke-width="5"/>
    <ellipse cx="124" cy="112" rx="12" ry="14" fill="#fff" stroke="#111" stroke-width="5"/>
    <circle cx="88" cy="113" r="4" fill="#111"/>
    <circle cx="124" cy="113" r="4" fill="#111"/>
    <path d="M86 140 Q106 150 126 140" stroke="#111" stroke-width="7" stroke-linecap="round" fill="none"/>
    <path d="M154 104 C208 92 244 138 236 194 C228 248 172 270 136 244 C112 228 108 190 122 156 C132 130 142 110 154 104 Z" fill="#7cc9f2" stroke="#111" stroke-width="8" stroke-linejoin="round"/>
    <path d="M166 138 L198 206" stroke="#111" stroke-width="8" stroke-linecap="round"/>
    <path d="M138 172 L224 172" stroke="#111" stroke-width="8" stroke-linecap="round"/>
`;

const bodyHeal = `
    <path d="M78 68 L136 68 L146 130 L70 130 Z" fill="#2f5a9d" stroke="#111" stroke-width="8" stroke-linejoin="round"/>
    <path d="M96 84 L118 84 L118 98 L132 98 L132 118 L118 118 L118 134 L96 134 L96 118 L82 118 L82 98 L96 98 Z" fill="#bfffd9" stroke="#111" stroke-width="5"/>
    <ellipse cx="106" cy="190" rx="78" ry="94" fill="#9fce89" stroke="#111" stroke-width="8"/>
    <ellipse cx="106" cy="148" rx="52" ry="56" fill="#c8f5b0" stroke="#111" stroke-width="8"/>
    <ellipse cx="90" cy="146" rx="12" ry="14" fill="#fff" stroke="#111" stroke-width="5"/>
    <ellipse cx="126" cy="146" rx="12" ry="14" fill="#fff" stroke="#111" stroke-width="5"/>
    <circle cx="90" cy="147" r="4" fill="#111"/>
    <circle cx="126" cy="147" r="4" fill="#111"/>
    <path d="M86 176 Q106 192 126 176" stroke="#111" stroke-width="7" stroke-linecap="round" fill="none"/>
    <ellipse cx="184" cy="204" rx="34" ry="46" fill="#6fc8ff" stroke="#111" stroke-width="8"/>
    <path d="M168 206 L200 206" stroke="#111" stroke-width="8" stroke-linecap="round"/>
    <path d="M184 190 L184 222" stroke="#111" stroke-width="8" stroke-linecap="round"/>
`;

const bodyCounter = `
    <ellipse cx="106" cy="204" rx="78" ry="84" fill="#9ccd86" stroke="#111" stroke-width="8"/>
    <ellipse cx="106" cy="116" rx="54" ry="60" fill="#bae6a6" stroke="#111" stroke-width="8"/>
    <ellipse cx="86" cy="112" rx="11" ry="14" fill="#fff" stroke="#111" stroke-width="5"/>
    <ellipse cx="124" cy="112" rx="11" ry="14" fill="#fff" stroke="#111" stroke-width="5"/>
    <circle cx="86" cy="113" r="4" fill="#111"/>
    <circle cx="124" cy="113" r="4" fill="#111"/>
    <path d="M84 140 Q106 156 128 140" stroke="#111" stroke-width="7" stroke-linecap="round" fill="none"/>
    <path d="M164 178 C184 118 236 114 246 172 C252 210 228 234 196 236 C172 236 150 216 164 178 Z" fill="#cda2f4" stroke="#111" stroke-width="8"/>
    <path d="M178 176 Q196 154 214 176" stroke="#111" stroke-width="8" stroke-linecap="round" fill="none"/>
    <path d="M184 198 Q198 212 214 196" stroke="#111" stroke-width="8" stroke-linecap="round" fill="none"/>
`;

save('card_attack.svg', cardTemplate({ left: '7', right: '7', body: bodyAttack, tint: '#fff7ea' }));
save('card_defense.svg', cardTemplate({ left: '6', right: '6', body: bodyDefense, tint: '#eef9ff' }));
save('card_heal.svg', cardTemplate({ left: '4', right: '4', body: bodyHeal, tint: '#effff1' }));
save('card_counter.svg', cardTemplate({ left: '8', right: '8', body: bodyCounter, tint: '#f8f0ff' }));

save('card_back.svg', svgDoc({
  width: 360,
  height: 480,
  body: `
  <rect x="10" y="10" width="340" height="460" rx="26" fill="#1d2b1d" stroke="#111" stroke-width="8"/>
  <rect x="28" y="28" width="304" height="424" rx="20" fill="#2f4d2f" stroke="#7cae64" stroke-width="4"/>
  <path d="M56 80 C118 38 242 38 304 80 C326 96 326 128 304 142 C242 184 118 184 56 142 C34 128 34 96 56 80 Z" fill="#7cbf60" stroke="#111" stroke-width="7"/>
  <path d="M120 248 C120 214 146 188 180 188 C214 188 240 214 240 248 C240 282 214 308 180 308 C146 308 120 282 120 248 Z" fill="#9ed67e" stroke="#111" stroke-width="7"/>
  <path d="M180 206 L180 290" stroke="#111" stroke-width="8" stroke-linecap="round"/>
  <path d="M138 248 L222 248" stroke="#111" stroke-width="8" stroke-linecap="round"/>
  <circle cx="112" cy="378" r="6" fill="#111"/>
  <circle cx="248" cy="378" r="6" fill="#111"/>
  <path d="M96 362 Q180 332 264 362" stroke="#111" stroke-width="7" fill="none" stroke-linecap="round"/>
`
}));

save('card_slot.svg', svgDoc({
  width: 360,
  height: 480,
  body: `
  <rect x="18" y="18" width="324" height="444" rx="24" fill="rgba(14,24,14,0.22)" stroke="#7ba16e" stroke-width="7" stroke-dasharray="20 15"/>
  <path d="M126 224 L234 224" stroke="#7ba16e" stroke-width="9" stroke-linecap="round"/>
  <path d="M180 170 L180 278" stroke="#7ba16e" stroke-width="9" stroke-linecap="round"/>
  <text x="180" y="330" text-anchor="middle" font-size="30" font-family="'Comic Sans MS', 'Trebuchet MS', sans-serif" fill="#9fc995" font-weight="700">DROP</text>
`
}));

function buttonTemplate({ text, sub = '', fill = '#f6bf5f', stroke = '#111', accent = '#7dbf65', glyph = '' }) {
  return svgDoc({
    width: 1180,
    height: 300,
    body: `
  <rect x="22" y="22" width="1136" height="256" rx="36" fill="${fill}" stroke="${stroke}" stroke-width="10"/>
  <path d="M66 44 L1112 44" stroke="rgba(255,255,255,0.45)" stroke-width="7" stroke-linecap="round"/>
  <path d="M82 256 L1096 256" stroke="rgba(0,0,0,0.25)" stroke-width="8" stroke-linecap="round"/>
  <circle cx="140" cy="150" r="78" fill="${accent}" stroke="#111" stroke-width="8"/>
  <text x="140" y="166" text-anchor="middle" font-size="78" font-family="'Comic Sans MS', 'Trebuchet MS', sans-serif" fill="#111" font-weight="700">${glyph}</text>
  <text x="590" y="148" text-anchor="middle" font-size="84" font-family="'Comic Sans MS', 'Trebuchet MS', sans-serif" fill="#111" font-weight="700">${text}</text>
  ${sub ? `<text x="590" y="214" text-anchor="middle" font-size="40" font-family="'Trebuchet MS', sans-serif" fill="#1f3118" font-weight="700">${sub}</text>` : ''}
`
  });
}

save('btn_pvp.svg', buttonTemplate({ text: 'PVP', sub: 'Find Battle', fill: '#f7b95a', accent: '#8dd073', glyph: '⚔' }));
save('btn_pve.svg', buttonTemplate({ text: 'PVE', sub: 'Training', fill: '#86d0ff', accent: '#9fe586', glyph: '🛡' }));
save('btn_tutorial.svg', buttonTemplate({ text: 'TUTORIAL', sub: 'Learn Fast', fill: '#d4b2ff', accent: '#9fe586', glyph: '✦' }));
save('btn_confirm.svg', buttonTemplate({ text: 'CONFIRM', sub: 'Lock Cards', fill: '#9ee388', accent: '#6dbb59', glyph: '✓' }));
save('btn_cancel.svg', buttonTemplate({ text: 'CANCEL', sub: 'Back', fill: '#f2a9a1', accent: '#e88478', glyph: '×' }));
save('btn_secondary.svg', buttonTemplate({ text: 'MENU', sub: 'Return', fill: '#e4e0d4', accent: '#b6d2a5', glyph: '☰' }));

save('menu_bg.svg', svgDoc({
  width: 1920,
  height: 1080,
  body: `
  <rect width="1920" height="1080" fill="#1c2b1a"/>
  <path d="M0 700 C260 620 420 760 700 700 C990 640 1120 790 1380 730 C1620 674 1760 760 1920 724 L1920 1080 L0 1080 Z" fill="#2d4a2b"/>
  <path d="M0 780 C250 736 430 844 710 804 C980 766 1190 862 1500 818 C1690 790 1830 820 1920 804 L1920 1080 L0 1080 Z" fill="#385f35"/>
  <path d="M126 580 C226 476 344 492 392 600 C438 702 370 794 262 792 C154 790 76 690 126 580 Z" fill="#6ba55b" stroke="#111" stroke-width="12"/>
  <circle cx="236" cy="580" r="18" fill="#fff" stroke="#111" stroke-width="8"/>
  <circle cx="298" cy="580" r="18" fill="#fff" stroke="#111" stroke-width="8"/>
  <circle cx="236" cy="584" r="7" fill="#111"/>
  <circle cx="298" cy="584" r="7" fill="#111"/>
  <path d="M226 640 Q266 676 306 640" stroke="#111" stroke-width="10" stroke-linecap="round" fill="none"/>
  <path d="M1530 550 C1600 468 1738 468 1798 560 C1848 636 1820 752 1724 778 C1614 808 1494 708 1530 550 Z" fill="#6ba55b" stroke="#111" stroke-width="12"/>
  <circle cx="1656" cy="592" r="16" fill="#fff" stroke="#111" stroke-width="8"/>
  <circle cx="1718" cy="592" r="16" fill="#fff" stroke="#111" stroke-width="8"/>
  <circle cx="1656" cy="596" r="7" fill="#111"/>
  <circle cx="1718" cy="596" r="7" fill="#111"/>
  <path d="M1650 654 Q1688 686 1722 652" stroke="#111" stroke-width="10" stroke-linecap="round" fill="none"/>
  <path d="M610 420 C760 300 960 292 1140 402" stroke="rgba(255,255,255,0.14)" stroke-width="14" stroke-linecap="round"/>
  <path d="M650 486 C764 412 928 406 1090 490" stroke="rgba(0,0,0,0.19)" stroke-width="12" stroke-linecap="round"/>
  <circle cx="770" cy="290" r="6" fill="#fff5"/>
  <circle cx="810" cy="250" r="4" fill="#fff6"/>
  <circle cx="1150" cy="280" r="5" fill="#fff5"/>
`
}));

save('battle_bg.svg', svgDoc({
  width: 1920,
  height: 1080,
  body: `
  <rect width="1920" height="1080" fill="#172216"/>
  <path d="M0 736 C258 660 484 824 736 760 C998 692 1160 846 1430 780 C1626 732 1774 810 1920 768 L1920 1080 L0 1080 Z" fill="#2a4529"/>
  <path d="M0 828 C300 770 520 900 760 852 C1030 800 1260 914 1542 856 C1708 822 1830 846 1920 834 L1920 1080 L0 1080 Z" fill="#395c37"/>
  <ellipse cx="960" cy="636" rx="390" ry="176" fill="#223923" stroke="#111" stroke-width="10"/>
  <ellipse cx="960" cy="646" rx="286" ry="120" fill="#4f7b49" stroke="#111" stroke-width="8"/>
  <path d="M690 530 L716 410 L790 378 L812 476 Z" fill="#8d6b45" stroke="#111" stroke-width="9"/>
  <path d="M1230 528 L1206 408 L1134 376 L1106 474 Z" fill="#8d6b45" stroke="#111" stroke-width="9"/>
  <path d="M746 436 L770 426 L788 446 L764 458 Z" fill="#ffcb69" stroke="#111" stroke-width="6"/>
  <path d="M1170 436 L1146 426 L1128 446 L1152 458 Z" fill="#ffcb69" stroke="#111" stroke-width="6"/>
  <circle cx="286" cy="566" r="68" fill="#6ca45c" stroke="#111" stroke-width="10"/>
  <circle cx="1638" cy="554" r="68" fill="#6ca45c" stroke="#111" stroke-width="10"/>
  <path d="M248 546 Q286 510 324 546" stroke="#111" stroke-width="8" fill="none"/>
  <path d="M1600 534 Q1638 498 1676 534" stroke="#111" stroke-width="8" fill="none"/>
`
}));

save('ornament_top.svg', svgDoc({
  width: 1280,
  height: 120,
  body: `
  <rect x="8" y="10" width="1264" height="100" rx="32" fill="#d8c29b" stroke="#111" stroke-width="8"/>
  <path d="M42 58 L1238 58" stroke="rgba(255,255,255,0.4)" stroke-width="6" stroke-linecap="round"/>
  <circle cx="90" cy="60" r="20" fill="#8fb67f" stroke="#111" stroke-width="6"/>
  <circle cx="1190" cy="60" r="20" fill="#8fb67f" stroke="#111" stroke-width="6"/>
`
}));

save('ornament_bottom.svg', svgDoc({
  width: 1280,
  height: 120,
  body: `
  <rect x="8" y="10" width="1264" height="100" rx="32" fill="#c6dab7" stroke="#111" stroke-width="8"/>
  <path d="M42 62 L1238 62" stroke="rgba(0,0,0,0.2)" stroke-width="7" stroke-linecap="round"/>
  <circle cx="96" cy="58" r="20" fill="#f2bd5f" stroke="#111" stroke-width="6"/>
  <circle cx="1184" cy="58" r="20" fill="#f2bd5f" stroke="#111" stroke-width="6"/>
`
}));

console.log(`\nOrc asset pack generated in: ${outDir}`);
