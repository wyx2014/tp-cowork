/** Local vector icons for skills, connectors and expert teams. */
const glyphs = {
  database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v7c0 4 16 4 16 0V5M4 12v7c0 4 16 4 16 0v-7"/>',
  chart: '<path d="M3 3v18h18M7 17v-4m5 4V9m5 8v-6M6 9l6-5 5 2 4-3"/>',
  network: '<rect x="9" y="2" width="6" height="6" rx="1.5"/><rect x="2" y="16" width="6" height="6" rx="1.5"/><rect x="16" y="16" width="6" height="6" rx="1.5"/><path d="M12 8v4M5 16v-4h14v4"/>',
  team: '<circle cx="12" cy="7" r="3"/><path d="M6 21v-3a6 6 0 0 1 12 0v3M4 5a3 3 0 0 0 0 6m16-6a3 3 0 0 1 0 6M2 19v-3a4 4 0 0 1 3-4m17 7v-3a4 4 0 0 0-3-4"/>',
  browser: '<rect x="2" y="3" width="20" height="18" rx="2"/><path d="M2 8h20M6 5.5h.01M9 5.5h.01m2 6.5 7 4-4 1-1 3Z"/>',
  art: '<path d="M12 3 3 19h18Z"/><circle cx="12" cy="13" r="3"/>',
  idea: '<path d="M9 18h6m-5 3h4M8 14a6 6 0 1 1 8 0c-1 .8-1 1.5-1 2H9c0-.5 0-1.2-1-2Z"/>',
  brand: '<path d="M12 3 5 6v6c0 4 7 8 7 8s7-4 7-8V6Z"/><path d="m8 11 3 3 5-5"/>',
  phone: '<path d="m7 3 3 5-3 3c2 3 3 4 6 6l3-3 5 3c0 4-3 5-6 4C8 18 3 13 3 7c0-3 1-4 4-4Z"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8" cy="9" r="1.5"/><path d="m3 17 6-5 4 4 3-3 5 5"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
  review: '<path d="m8 6-5 5 5 5m8-10 5 5-3 3m-7 3 3 3 6-6"/>',
  agent: '<rect x="4" y="7" width="16" height="13" rx="3"/><path d="M12 3v4M8 15h.01M16 15h.01M9 18h6M1 11v5m22-5v5"/>',
  wand: '<path d="m4 20 12-12 4 4L8 24M14 10l4 4" transform="translate(0 -3)"/><path d="M5 3v4M3 5h4m12-3v4m-2-2h4"/>',
  research: '<path d="M5 3h10l4 4v6M5 3v18h8M8 7h5m-5 4h4"/><circle cx="17" cy="17" r="4"/><path d="m20 20 2 2"/>',
  document: '<path d="M14 2H5v20h14V7l-5-5v5h5M8 12h8M8 16h6"/>',
  layout: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M9 9v11"/>',
  scan: '<path d="M3 8V3h5m8 0h5v5M3 16v5h5m8 0h5v-5M3 12h18m-13 4h8M9 7h6"/>',
  message: '<path d="M21 11a9 8 0 0 1-9 8H8l-5 3 1-6a7 7 0 0 1-1-5 9 8 0 0 1 18 0Z"/><path d="M8 10h8m-8 4h5"/>',
  plug: '<path d="M8 3v5m8-5v5M5 8h14v3a7 7 0 0 1-14 0Zm7 10v4"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 2v6m10-6v6M3 11h18m-14 4h3m4 0h3m-10 3h3"/>',
  animation: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m10 8 6 4-6 4Z"/>',
  summary: '<path d="M5 4h14M5 8h14M5 12h9M5 16h6m4 0 3 3 4-6"/>',
  palette: '<circle cx="8" cy="8" r="1"/><circle cx="14" cy="6" r="1"/><circle cx="18" cy="11" r="1"/><path d="M12 3a9 9 0 1 0 0 18c3 0 3-3 1-4-1-1 0-3 2-3h3c5 0 3-11-6-11Z"/>',
  translate: '<path d="M3 5h11M8 3v2m3 0c0 6-4 10-8 11m2-9c1 3 3 6 7 8m1 6 4-11 4 11m-6-4h5"/>',
  web: '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
  test: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 8h18m-14 6 3 3 7-6"/>',
} as const
const colors = {
  blue: ['#48b2ff', '#2878ed'], violet: ['#b088ff', '#8052df'], teal: ['#3cd6bc', '#10a18a'],
  orange: ['#ffc35b', '#ec8d24'], green: ['#49d998', '#0fa56c'], pink: ['#fb91c3', '#cd4b94'], slate: ['#8faac7', '#516c90'],
} as const

export function capabilityIcon(glyph: keyof typeof glyphs, color: keyof typeof colors): string {
  const [light, dark] = colors[color]
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><defs><linearGradient id="bg" x2=".8" y2="1"><stop stop-color="${light}"/><stop offset="1" stop-color="${dark}"/></linearGradient></defs><rect x="3" y="2" width="26" height="28" rx="6" fill="url(#bg)"/><rect x="3.5" y="2.5" width="25" height="27" rx="5.5" fill="none" stroke="white" stroke-opacity=".22"/><g transform="translate(7 7) scale(.75)" fill="none" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${glyphs[glyph]}</g></svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}
