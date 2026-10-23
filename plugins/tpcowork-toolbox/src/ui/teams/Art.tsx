import * as React from 'react'

/** Local member portraits stay sharp and available offline. */
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
