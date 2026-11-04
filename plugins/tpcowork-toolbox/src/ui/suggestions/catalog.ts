import terminal from './assets/terminal.png'
import browser from './assets/browser-use.png'
import presentations from './assets/presentations.png'
import finder from './assets/finder.png'
import documents from './assets/documents.png'
import spreadsheets from './assets/spreadsheets.png'
import type { UiKey } from '../locales.ts'
import type { T } from '../types.ts'
import { skillPresentation } from '../skill-presentation.ts'

export interface Suggestion { id: string; title: UiKey; label: UiKey; prompt: UiKey; icon: string; skill?: string }
export const suggestions: readonly Suggestion[] = [
  { id: 'disk', title: 'suggestionDiskTitle', label: 'suggestionDisk', prompt: 'suggestionDiskPrompt', icon: terminal },
  { id: 'news', title: 'suggestionNewsTitle', label: 'suggestionNews', prompt: 'suggestionNewsPrompt', icon: browser, skill: 'control-browser' },
  { id: 'presentation', title: 'suggestionPresentationTitle', label: 'suggestionPresentation', prompt: 'suggestionPresentationPrompt', icon: presentations, skill: 'office-pptx' },
  { id: 'downloads', title: 'suggestionDownloadsTitle', label: 'suggestionDownloads', prompt: 'suggestionDownloadsPrompt', icon: finder },
  { id: 'document', title: 'suggestionDocumentTitle', label: 'suggestionDocument', prompt: 'suggestionDocumentPrompt', icon: documents, skill: 'office-docx' },
  { id: 'spreadsheet', title: 'suggestionSpreadsheetTitle', label: 'suggestionSpreadsheet', prompt: 'suggestionSpreadsheetPrompt', icon: spreadsheets, skill: 'office-xlsx' },
]
export function suggestionSkillLabel(name: string, t: T): string { return skillPresentation(name, t).label }
export function suggestionBatch(index: number): readonly Suggestion[] { return Array.from({ length: 3 }, (_, offset) => suggestions[(index * 3 + offset) % suggestions.length]!) }
