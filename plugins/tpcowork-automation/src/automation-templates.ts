/** Six bilingual source templates; selecting one only fills an unsaved draft. */
import type { ScheduleTaskDraft } from './types.ts';

export type AutomationTemplateIcon =
  | 'weeklyReport'
  | 'morningBrief'
  | 'news'
  | 'monthlyReview'
  | 'knowledge'
  | 'mail';

export interface AutomationTemplate {
  id: string;
  icon: AutomationTemplateIcon;
  draft: ScheduleTaskDraft;
}

const zhTemplates: AutomationTemplate[] = [
  {
    id: 'weekly-work-report',
    icon: 'weeklyReport',
    draft: {
      name: '每周工作周报',
      description: '基于当前工作区汇总本周成果与下周计划',
      prompt: '检查当前工作区中本周更新的文档、代码提交、会议记录和项目资料，整理本周完成事项、关键进展、数据成果、风险阻塞和下周计划。合并重复内容，按重要性排序；信息不足时明确标注待补充项，不要编造。输出一份结构清晰、可直接发送的精简工作周报。',
      schedule: { frequency: 'weekly', time: { hour: 17, minute: 30 }, dayOfWeek: 5 },
    },
  },
  {
    id: 'daily-morning-work-brief',
    icon: 'morningBrief',
    draft: {
      name: '每日工作晨间简报',
      description: '每天上班前整理今日安排、重点与风险',
      prompt: '结合当前工作区的项目计划、待办、近期文档和未完成事项，生成今日晨间工作简报。包含：今日最重要的 3 项任务、会议与截止时间、需要跟进的人或事项、潜在风险，以及建议的时间安排。没有依据的内容不要猜测，请明确标为待确认。输出要简洁、可执行。',
      schedule: { frequency: 'daily', time: { hour: 8, minute: 45 } },
    },
  },
  {
    id: 'ai-daily-brief',
    icon: 'news',
    draft: {
      name: '每日 AI 新闻推送',
      description: '汇总过去 24 小时值得关注的 AI 动态',
      prompt: '搜索过去 24 小时 AI 领域的重要动态，筛选 5 条真正有影响的信息。每条包含标题、两句摘要、影响判断和来源链接，最后给出今日最值得关注的一条。优先采用官方公告、论文和可信媒体，标明事件发生时间，避免重复、未经证实的消息和营销软文。',
      schedule: { frequency: 'daily', time: { hour: 8, minute: 30 } },
    },
  },
  {
    id: 'monthly-work-review',
    icon: 'monthlyReview',
    draft: {
      name: '月度工作复盘',
      description: '每月复盘成果、问题与下月行动计划',
      prompt: '检查当前工作区中上一个自然月的项目资料、周报、会议记录和任务进展，完成月度工作复盘。包含：关键目标完成度、主要成果及数据、做得好的地方、问题与根因、未完成事项、经验沉淀，以及下月 3–5 项优先行动。引用可核实的工作区依据；信息不足时列出待补充项，不要编造。',
      schedule: { frequency: 'monthly', time: { hour: 9, minute: 0 }, dayOfMonth: 1 },
    },
  },
  {
    id: 'knowledge-capture-assistant',
    icon: 'knowledge',
    draft: {
      name: '知识沉淀助手',
      description: '定期把零散工作信息整理为可复用知识',
      prompt: '检查当前工作区最近一周新增或更新的会议记录、方案、问题处理记录和项目文档，提炼可复用的知识。按“背景与目标、关键结论、方法步骤、踩坑与解决方案、后续可复用模板”整理；合并重复信息，保留来源文件引用，并列出需要人工确认的内容。将结果输出为适合归档的知识总结。',
      schedule: { frequency: 'weekly', time: { hour: 16, minute: 30 }, dayOfWeek: 5 },
    },
  },
  {
    id: 'daily-email-todo-extractor',
    icon: 'mail',
    draft: {
      name: '每日邮件待办提取',
      description: '从当日邮件中提取待办、负责人和截止时间',
      prompt: '读取今天收到且有权访问的邮件，识别其中需要我处理、回复、审批或跟进的事项。输出待办清单，每项包含事项、来源邮件、负责人、截止时间、优先级和建议下一步；合并同一线程的重复要求，区分明确任务与仅供参考的信息。无法访问邮箱或信息不明确时，请直接说明并列出需要补充的连接或确认项。',
      schedule: { frequency: 'daily', time: { hour: 17, minute: 0 } },
    },
  },
];

const enTemplates: AutomationTemplate[] = [
  {
    id: 'weekly-work-report',
    icon: 'weeklyReport',
    draft: {
      name: 'Weekly work report',
      description: 'Turn this workspace’s weekly activity into a concise report',
      prompt: 'Review documents, commits, meeting notes, and project records updated this week in the current workspace. Summarize completed work, key progress, measurable outcomes, blockers, risks, and next-week priorities. Merge duplicates, order items by importance, and clearly mark missing information instead of inventing it. Produce a concise report ready to send.',
      schedule: { frequency: 'weekly', time: { hour: 17, minute: 30 }, dayOfWeek: 5 },
    },
  },
  {
    id: 'daily-morning-work-brief',
    icon: 'morningBrief',
    draft: {
      name: 'Daily morning work brief',
      description: 'Start the workday with priorities, commitments, and risks',
      prompt: 'Use project plans, tasks, recent documents, and unfinished work in the current workspace to prepare today’s morning brief. Include the three most important tasks, meetings and deadlines, people or items to follow up, potential risks, and a suggested time plan. Do not guess when evidence is missing; mark those items for confirmation. Keep the result concise and actionable.',
      schedule: { frequency: 'daily', time: { hour: 8, minute: 45 } },
    },
  },
  {
    id: 'ai-daily-brief',
    icon: 'news',
    draft: {
      name: 'Daily AI news brief',
      description: 'Summarize the most important AI updates from the last 24 hours',
      prompt: 'Research important AI developments from the last 24 hours and select five genuinely consequential updates. For each, include a headline, two-sentence summary, why it matters, and a source link. End with the single update most worth watching. Prefer official announcements, papers, and reputable reporting; include event dates and exclude duplicates, unverified claims, and promotional content.',
      schedule: { frequency: 'daily', time: { hour: 8, minute: 30 } },
    },
  },
  {
    id: 'monthly-work-review',
    icon: 'monthlyReview',
    draft: {
      name: 'Monthly work review',
      description: 'Review outcomes, lessons, and priorities for the next month',
      prompt: 'Review project materials, weekly reports, meeting notes, and task progress from the previous calendar month in the current workspace. Cover goal completion, key outcomes and metrics, what worked, problems and root causes, unfinished work, reusable lessons, and three to five priorities for next month. Cite verifiable workspace evidence and list missing information instead of inventing it.',
      schedule: { frequency: 'monthly', time: { hour: 9, minute: 0 }, dayOfMonth: 1 },
    },
  },
  {
    id: 'knowledge-capture-assistant',
    icon: 'knowledge',
    draft: {
      name: 'Knowledge capture assistant',
      description: 'Turn scattered weekly work into reusable knowledge',
      prompt: 'Review meeting notes, plans, issue-resolution records, and project documents added or updated in the current workspace over the last week. Extract reusable knowledge under context and goals, key conclusions, methods and steps, pitfalls and solutions, and reusable templates. Merge duplicates, retain source-file references, flag anything requiring confirmation, and produce a summary ready for the knowledge base.',
      schedule: { frequency: 'weekly', time: { hour: 16, minute: 30 }, dayOfWeek: 5 },
    },
  },
  {
    id: 'daily-email-todo-extractor',
    icon: 'mail',
    draft: {
      name: 'Daily email action extractor',
      description: 'Extract actions, owners, and deadlines from today’s email',
      prompt: 'Review today’s email that I have authorized you to access and identify items requiring my action, reply, approval, or follow-up. Produce a task list with the action, source email, owner, deadline, priority, and recommended next step. Merge duplicate requests in the same thread and separate explicit actions from informational messages. If email access is unavailable or details are ambiguous, say so and list the connection or clarification needed.',
      schedule: { frequency: 'daily', time: { hour: 17, minute: 0 } },
    },
  },
];

export function getAutomationTemplates(locale: string): AutomationTemplate[] {
  return locale.startsWith('zh') ? zhTemplates : enTemplates;
}
