import type { Priority } from '../types'

export type Lang = 'en' | 'sk'

export type Strings = {
  title: string
  heading: string
  questions: string
  tasks: string
  waiting: (questions: number, tasks: number) => string
  show: string
  allClear: string
  emptyHint: string
  done: (count: number) => string
  older: (count: number) => string
  more: string
  less: string
  ask: string
  priority: Record<Priority, string>
  action: string
  inPrompt: string
  answerHint: string
  replyHint: string
  send: string
  reply: string
  picked: string
  askHint: string
  explain: string
  toPrompt: string
  markAnswered: string
  markDone: string
  copy: string
  copied: string
  drop: string
  reopen: string
  next: string
  previous: string
  recommended: string
  thinking: string
  you: string
  claude: string
  sideChat: string
  answered: string
  finished: string
  settled: string
  dropped: string
  drafted: string
  sent: string
  queued: string
  notSent: (why: string) => string
  noFill: string
  newOne: (count: number) => string
  cleared: string
  reset: string
  noFork: string
  hint: (questions: number, tasks: number) => string
  hintClear: string
}

const en: Strings = {
  title: 'Loose ends',
  heading: 'Waiting on you',
  questions: 'Questions',
  tasks: 'Tasks',
  waiting: (questions, tasks) => {
    const parts = [
      ...(questions > 0 ? [questions === 1 ? '1 question' : `${questions} questions`] : []),
      ...(tasks > 0 ? [tasks === 1 ? '1 task' : `${tasks} tasks`] : []),
    ]
    return `${parts.join(' and ')} ${questions + tasks === 1 ? 'waits' : 'wait'} on you`
  },
  show: 'Show',
  allClear: 'Nothing waits on you.',
  emptyHint: 'What Claude asks you, or asks you to do, shows up here word for word.',
  done: count => `Done · ${count}`,
  older: count => `Older · ${count}`,
  more: 'More',
  less: 'Less',
  ask: 'Ask',
  priority: { blocking: 'waits on you', decision: 'decision', optional: 'optional' },
  action: 'your step',
  inPrompt: 'in the prompt box',
  answerHint: 'answer, Enter sends it',
  replyHint: 'reply, Enter sends it',
  send: 'Send',
  reply: 'Reply',
  picked: 'picked',
  askHint: 'ask about it, Claude answers here only',
  explain: 'Explain',
  toPrompt: 'In prompt',
  markAnswered: 'Answered',
  markDone: 'Done',
  copy: 'Copy',
  copied: 'Copied.',
  drop: 'Drop',
  reopen: 'Reopen',
  next: 'next',
  previous: 'previous',
  recommended: 'recommended',
  thinking: 'thinking…',
  you: 'you',
  claude: 'claude',
  sideChat: 'side chat, outside the conversation',
  answered: 'answered',
  finished: 'done',
  settled: 'settled by Claude',
  dropped: 'dropped',
  drafted: 'The answer is in the prompt box. Edit it there, then press Enter.',
  sent: 'Sent.',
  queued: 'Sent. Claude reads it once the current turn ends.',
  notSent: why => `Not sent: ${why}`,
  noFill: 'The prompt box is busy, so the answer is on your clipboard.',
  newOne: count => (count === 1 ? 'Claude asked you something' : `Claude asked you ${count} things`),
  cleared: 'Answered questions cleared.',
  reset: 'All questions removed.',
  noFork: 'Could not reach the conversation; answered from the question alone.',
  hint: (questions, tasks) =>
    '/loose-ends · ' +
    [
      ...(questions > 0 ? [`${questions} ${questions === 1 ? 'question' : 'questions'}`] : []),
      ...(tasks > 0 ? [`${tasks} ${tasks === 1 ? 'task' : 'tasks'}`] : []),
    ].join(', '),
  hintClear: '/loose-ends ✓',
}

const sk: Strings = {
  title: 'Nedoriešené',
  heading: 'Čaká na teba',
  questions: 'Otázky',
  tasks: 'Úlohy',
  waiting: (questions, tasks) => {
    const q = questions === 1 ? '1 otázka' : questions < 5 ? `${questions} otázky` : `${questions} otázok`
    const t = tasks === 1 ? '1 úloha' : tasks < 5 ? `${tasks} úlohy` : `${tasks} úloh`
    const parts = [...(questions > 0 ? [q] : []), ...(tasks > 0 ? [t] : [])]
    return `Na teba čaká ${parts.join(' a ')}`
  },
  show: 'Ukázať',
  allClear: 'Nič na teba nečaká.',
  emptyHint: 'Na čo sa ťa Claude spýta alebo čo ťa požiada spraviť, sa tu objaví doslovne.',
  done: count => `Vybavené · ${count}`,
  older: count => `Staršie · ${count}`,
  more: 'Viac',
  less: 'Menej',
  ask: 'Spýtaj sa',
  priority: { blocking: 'čaká na teba', decision: 'rozhodnutie', optional: 'voliteľné' },
  action: 'tvoj krok',
  inPrompt: 'v poli na prompt',
  answerHint: 'odpoveď, Enter ju pošle',
  replyHint: 'správa, Enter ju pošle',
  send: 'Poslať',
  reply: 'Odpovedať',
  picked: 'vybraté',
  askHint: 'opýtaj sa, Claude odpovie len tu',
  explain: 'Vysvetli',
  toPrompt: 'Do promptu',
  markAnswered: 'Zodpovedané',
  markDone: 'Hotovo',
  copy: 'Kopírovať',
  copied: 'Skopírované.',
  drop: 'Zahodiť',
  reopen: 'Znova otvoriť',
  next: 'ďalšia',
  previous: 'predošlá',
  recommended: 'odporúča',
  thinking: 'premýšľa…',
  you: 'ty',
  claude: 'claude',
  sideChat: 'bočný chat, mimo rozhovoru',
  answered: 'zodpovedané',
  finished: 'hotovo',
  settled: 'vyriešil Claude',
  dropped: 'zahodené',
  drafted: 'Odpoveď je v poli na prompt. Uprav ju tam a stlač Enter.',
  sent: 'Odoslané.',
  queued: 'Odoslané. Claude to dostane, keď dokončí aktuálny ťah.',
  notSent: why => `Neodoslané: ${why}`,
  noFill: 'Pole na prompt je zaneprázdnené, odpoveď máš v schránke.',
  newOne: count => (count === 1 ? 'Claude od teba niečo potrebuje' : `Claude od teba potrebuje ${count} veci`),
  cleared: 'Vybavené otázky sú preč.',
  reset: 'Všetky otázky sú preč.',
  noFork: 'Rozhovor nebol dostupný, odpoveď vychádza len z otázky.',
  hint: (questions, tasks) => {
    const q = questions === 1 ? '1 otázka' : questions < 5 ? `${questions} otázky` : `${questions} otázok`
    const t = tasks === 1 ? '1 úloha' : tasks < 5 ? `${tasks} úlohy` : `${tasks} úloh`
    return '/loose-ends · ' + [...(questions > 0 ? [q] : []), ...(tasks > 0 ? [t] : [])].join(', ')
  },
  hintClear: '/loose-ends ✓',
}

/**
 * The labels' fallback language, for the panel with nothing in it and for an
 * item whose language is not known: the mod's own `language` option; on
 * `auto`, Claude Code's `language` setting; with none, the system locale. A
 * language the panel has no words for gets English.
 */
export const uiLang = (setting: string, claudeLanguage: unknown, locale: string | undefined): Lang => {
  if (setting === 'en' || setting === 'sk') return setting
  const said = typeof claudeLanguage === 'string' ? claudeLanguage.trim().toLowerCase() : ''
  if (said) return /^(sk|slovak|slovensky|slovenčina|slovencina)\b/.test(said) ? 'sk' : 'en'
  return /^sk(?:[_.@-]|$)/i.test(locale ?? '') ? 'sk' : 'en'
}

/**
 * The labels' language for one question or task, from the language Claude
 * wrote it in: Slovak for Slovak, English for every other language the panel
 * has no words for, and `fallback` when the language is not known.
 */
export const langOf = (code: string | undefined, fallback: Lang): Lang =>
  code === undefined ? fallback : code === 'sk' ? 'sk' : 'en'

export const strings = (lang: Lang): Strings => (lang === 'sk' ? sk : en)

export const ago = (ms: number): string => {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}
