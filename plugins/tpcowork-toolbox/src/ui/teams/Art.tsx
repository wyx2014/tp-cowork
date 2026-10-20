import * as React from 'react'
import type { TeamProfile } from './profile.ts'

/** Local vector artwork stays sharp and available offline in the bundled Client. */
export function TeamEmblem({ theme }: { theme: TeamProfile['theme'] }) {
  const gradient = React.useId()
  const supply = theme === 'supply'
  return <svg className="tp-team-emblem" viewBox="0 0 104 104" fill="none" aria-hidden="true">
    <defs><linearGradient id={gradient} x1="4" y1="4" x2="100" y2="104" gradientUnits="userSpaceOnUse"><stop stopColor={supply ? '#453674' : '#123f48'} /><stop offset="1" stopColor={supply ? '#17172f' : '#0e252c'} /></linearGradient></defs>
    <rect width="104" height="104" rx="26" fill={`url(#${gradient})`} />
    <circle cx="78" cy="24" r="26" fill={supply ? '#9b8bd5' : '#69d6bc'} opacity=".1" />
    <path d="M14 32h76M14 48h76M14 64h76M28 16v60M52 16v60M76 16v60" stroke="white" strokeOpacity=".07" />
    {supply ? <g stroke="#bdb0ed" strokeWidth="2"><path d="m28 32 24-12 24 12v28L52 74 28 60V32Zm0 0 24 14 24-14M52 46v28" /><circle cx="28" cy="32" r="4" fill="#bdb0ed" /><circle cx="76" cy="32" r="4" fill="#bdb0ed" /><circle cx="52" cy="74" r="4" fill="#bdb0ed" /></g>
      : <><path d="m20 52 17-15 14 7 25-24" stroke="#72e0bf" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /><path d="M65 20h11v11" stroke="#72e0bf" strokeWidth="3" strokeLinecap="round" /><path d="M22 58h9v14h-9zm17-8h9v22h-9zm17-2h9v24h-9zm17-10h9v34h-9z" fill="#72e0bf" opacity=".18" /></>}
    <path d="M23 96v-8c0-10 11-14 29-14s29 4 29 14v8" fill={supply ? '#7566ae' : '#398e85'} />
    <path d="m43 75 9 10 9-10" fill="#f0dcc6" /><path d="m52 85-4 11h8z" fill={supply ? '#cec4ee' : '#b3f0de'} />
    <circle cx="52" cy="59" r="15" fill="#f0dcc6" /><path d="M37 58c-3-20 24-27 29-9l-1 10-6-12-21 12" fill="#172b37" />
    <path d="M42 59h8m4 0h8m-12 0h4" stroke="#172b37" strokeWidth="1.6" /><path d="M44 58v5h6v-5m5 0v5h6v-5" stroke="#172b37" strokeWidth="1.3" /><path d="M48 68q4 3 8 0" stroke="#ba8a77" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
}

const colors = [
  ['#e0efef', '#487d83', '#f2d1b6', '#304451'], ['#e9e5f5', '#73629b', '#e9bc99', '#413747'],
  ['#e2eee3', '#61846a', '#f1d6bd', '#3e4a41'], ['#f6e8df', '#b27c66', '#f0c5aa', '#64443c'],
  ['#e4eaf4', '#637fa0', '#e9c5a7', '#32455b'],
] as const
export function MemberAvatar({ index }: { index: number }) {
  const [background, shirt, skin, hair] = colors[index % colors.length]!
  return <svg className="tp-team-avatar" viewBox="0 0 56 56" fill="none" aria-hidden="true">
    <rect width="56" height="56" rx="15" fill={background} /><circle cx="45" cy="9" r="16" fill="white" opacity=".25" />
    <path d="M7 56v-5c0-10 8-16 21-16s21 6 21 16v5" fill={shirt} /><path d="m22 35 6 9 6-9" fill={skin} />
    <path d="m17 38 11 6-7 6m18-12-11 6 7 6" stroke="white" strokeOpacity=".3" strokeWidth="1.5" />
    <rect x="16" y="12" width="24" height="27" rx="12" fill={skin} />
    {index % 2 ? <path d="M15 26C9 3 44 1 42 25l-7-10-7 4-10-1-3 8" fill={hair} /> : <path d="M15 25C11 2 43 2 41 25l-5-11-17 5-4 6" fill={hair} />}
    <path d="M22 25h1m10 0h1" stroke={hair} strokeWidth="2" strokeLinecap="round" />
    {index % 3 === 1 && <path d="M18 23h9v6h-9v-6Zm12 0h9v6h-9v-6Zm-3 2h3" stroke={hair} strokeWidth="1.4" />}
    <path d="M25 33q3 2 6 0" stroke="#b37f68" strokeWidth="1.3" strokeLinecap="round" />
  </svg>
}
