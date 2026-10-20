/** Small outline icons rendered with the Client's existing React instance. */
import * as React from 'react'

const paths = {
  clock: <><circle cx="12" cy="12" r="8" /><path d="M12 7v5l3 2M5 3 2 6m17-3 3 3" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  wand: <><path d="m4 20 12-12 4 4L8 24M14 10l4 4" transform="translate(0 -3)" /><path d="M5 3v4M3 5h4m12-3v4m-2-2h4" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6m0-10h.01" /></>,
  edit: <><path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15z" /></>,
  play: <path d="m8 5 11 7-11 7z" />,
  pause: <><path d="M8 5v14M16 5v14" /></>,
  more: <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>,
  external: <><path d="M14 3h7v7m0-7L10 14M10 5H4v16h16v-6" /></>,
  trash: <><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7" /></>,
  arrow: <path d="m9 5 7 7-7 7" />,
  back: <path d="m15 5-7 7 7 7M8 12h13" />,
  down: <path d="m6 9 6 6 6-6" />,
  hand: <><path d="M8 13V6a2 2 0 0 1 4 0v6-9a2 2 0 0 1 4 0v9-6a2 2 0 0 1 4 0v10c0 4-2 6-6 6h-2c-2 0-3-1-4-3l-4-6a2 2 0 0 1 3-2l3 3" /></>,
  brain: <><path d="M12 4a3 3 0 0 0-6-1 4 4 0 0 0-3 6 4 4 0 0 0 0 7 4 4 0 0 0 4 5 3 3 0 0 0 5-2V4m0 0a3 3 0 0 1 6-1 4 4 0 0 1 3 6 4 4 0 0 1 0 7 4 4 0 0 1-4 5 3 3 0 0 1-5-2M6 9l3 2m9-2-3 2M7 16h2m6 0h2" /></>,
  folder: <path d="M3 7V5h6l2 2h10v13H3z" />,
  link: <><path d="m10 13 4-4m-6 6-2 2a3.5 3.5 0 0 1-5-5l4-4a3.5 3.5 0 0 1 5 0m4 8a3.5 3.5 0 0 0 5 0l4-4a3.5 3.5 0 0 0-5-5l-2 2" transform="translate(1 0)" /></>,
  weeklyReport: <><rect x="5" y="3" width="15" height="18" rx="2" /><path d="M9 3v18M3 7h4m-4 5h4m-4 5h4m5-9h5m-5 4h5m-5 4h3" /></>,
  morningBrief: <><path d="M3 17h18M5 21h14M7 17a5 5 0 0 1 10 0M12 2v4M3 9l3 2m15-2-3 2M12 9V6m-2 2 2-2 2 2" /></>,
  news: <><path d="M5 3h16v16a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8h2M5 3v16m4-12h8m-8 4h8m-8 4h3m3 0h2" /></>,
  monthlyReview: <><path d="M4 3v18h17M8 16v-5m5 5V7m5 9v-4" /></>,
  knowledge: <><path d="M12 5C9 3 5 3 2 4v15c3-1 7-1 10 1 3-2 7-2 10-1V4c-3-1-7-1-10 1v15M5 8h4m-4 4h4m6 0 2 2 3-4" /></>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 6 9 7 9-7m-7 11 2 2 4-4" /></>,
} satisfies Record<string, React.ReactNode>

/** @param name - Icon identifier. @param size - Rendered width and height. */
export function AutomationIcon({ name, size = 16 }: { name: keyof typeof paths; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}
