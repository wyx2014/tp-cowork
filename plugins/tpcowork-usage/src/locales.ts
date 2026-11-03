/** Page copy, from the reference product's Usage stats section. */
export const en = {
  nav: 'Usage stats', title: 'Usage stats', appUsage: 'App usage',
  lifetimeTotalTokens: 'Total tokens', lifetimePeakTokens: 'Peak tokens', longestSession: 'Longest session',
  currentStreak: 'Current streak', longestStreak: 'Longest streak',
  durationDay: 'd', durationHour: 'h', durationMinute: 'm',
  heatmapTitle: 'Token activity', heatmapDaily: 'Daily', heatmapWeekly: 'Weekly', heatmapCumulative: 'Cumulative',
  heatmapCell: '{date}\n{tokens} tokens · {turns} messages',
  heatmapWeeklyCell: '{date} week\n{tokens} tokens · {turns} messages',
  heatmapCumulativeCell: 'Through {date} week cumulative\n{tokens} tokens · {turns} messages',
  rangeTitle: 'Time range', range7d: 'Last 7 days', range30d: 'Last 30 days',
  dailyChartTitle: 'Daily token trend chart', modelChartTitle: 'Model usage', otherModels: 'Other models', unknownModel: 'Unknown model',
  tokenUnit: 'tokens', refresh: 'Refresh',
  loadingTitle: 'Computing usage', loadingDescription: 'Reading local app session history, so it can take a moment.',
  emptyTitle: 'No usage data yet', emptyDescription: 'The selected range has no usage data yet.',
  error: 'Unable to load usage stats. Try again later.',
}
export const zh: typeof en = {
  nav: '使用统计', title: '使用统计', appUsage: '应用用量',
  lifetimeTotalTokens: '累计 Token 数', lifetimePeakTokens: '峰值 Token 数', longestSession: '最长聊天时长',
  currentStreak: '当前连续天数', longestStreak: '最长连续天数',
  durationDay: '天', durationHour: '小时', durationMinute: '分钟',
  heatmapTitle: 'Token 活动', heatmapDaily: '每日', heatmapWeekly: '每周', heatmapCumulative: '累计',
  heatmapCell: '{date}\n{tokens} tokens · {turns} 轮消息',
  heatmapWeeklyCell: '{date} 当周\n{tokens} tokens · {turns} 轮消息',
  heatmapCumulativeCell: '截至 {date} 当周累计\n{tokens} tokens · {turns} 轮消息',
  rangeTitle: '时间范围', range7d: '近 7 日', range30d: '近 30 日',
  dailyChartTitle: '每日 Token 趋势图', modelChartTitle: '模型用量', otherModels: '其他模型', unknownModel: '未知模型',
  tokenUnit: 'tokens', refresh: '刷新',
  loadingTitle: '正在统计中', loadingDescription: '正在读取本地应用会话历史，可能需要一点时间。',
  emptyTitle: '还没有可展示的数据', emptyDescription: '当前区间暂无可展示的用量数据。',
  error: '无法读取用量统计。请稍后重试。',
}
export type UsageKey = keyof typeof en
