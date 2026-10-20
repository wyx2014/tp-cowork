import * as React from 'react'

const paths = {
  globe: <><circle cx="12" cy="12" r="9" /><ellipse cx="12" cy="12" rx="4" ry="9" /><path d="M3 12h18" /></>,
  terminal: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="m7 9 3 3-3 3m6 0h4" /></>,
  json: <><path d="M14 2H5v20h14V7l-5-5v5h5M10 11c-2 0 0 3-2 3 2 0 0 3 2 3m4-6c2 0 0 3 2 3-2 0 0 3-2 3" /></>,
  upload: <path d="M12 16V3m-4 4 4-4 4 4M4 16v5h16v-5" />,
  play: <path d="m8 4 13 8-13 8Z" />,
  download: <><path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5" /></>,
  spinner: <path className="tp-store-spinner" d="M20 12a8 8 0 1 1-8-8" />,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21v-2a8 8 0 0 1 16 0v2" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  wand: <><path d="m4 20 12-12 4 4L8 24M14 10l4 4" transform="translate(0 -3)" /><path d="M5 3v4M3 5h4m12-3v4m-2-2h4" /></>,
  refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6 7a7 7 0 0 1 12-1l2 3M4 15l2 3a7 7 0 0 0 12-1" /></>,
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></>,
  folder: <path d="M3 7V5h6l2 2h10v13H3z" />,
  arrow: <path d="m9 5 7 7-7 7" />,
  down: <path d="m6 9 6 6 6-6" />,
  check: <path d="m5 12 4 4L19 6" />,
  trash: <><path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 10v7M14 10v7" /></>,
  idea: <><path d="M9 18h6m-5 3h4M8 14a6 6 0 1 1 8 0c-1 .8-1 1.5-1 2H9c0-.5 0-1.2-1-2Z" /><path d="M12 1v1M3 4l1 1m16-1-1 1M1 11h2m18 0h2" /></>,
  grid: <><rect x="3" y="3" width="7" height="7" rx="2" /><rect x="14" y="3" width="7" height="7" rx="2" /><rect x="3" y="14" width="7" height="7" rx="2" /><rect x="14" y="14" width="7" height="7" rx="2" /></>,
  team: <><circle cx="9" cy="8" r="3" /><path d="M3 21v-3a6 6 0 0 1 12 0v3m1-16a3 3 0 0 1 0 6m2 4a4 4 0 0 1 3 4v2" /></>,
  chat: <><path d="M21 11a9 8 0 0 1-9 8H8l-5 3 1-6a7 7 0 0 1-1-5 9 8 0 0 1 18 0Z" /><path d="m10 8-3 3 3 3m4-6 3 3-3 3" /></>,
  flow: <><rect x="8" y="2" width="8" height="5" rx="1" /><rect x="2" y="17" width="8" height="5" rx="1" /><rect x="14" y="17" width="8" height="5" rx="1" /><path d="M12 7v5m-6 5v-5h12v5" /></>,
  report: <><path d="M14 2H5v20h14V7l-5-5v5h5M8 12h8M8 16h8" /></>,
} satisfies Record<string, React.ReactNode>

export function ToolboxIcon({ name, size = 16 }: { name: keyof typeof paths; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}
