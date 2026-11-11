export type Priority = 'blocking' | 'decision' | 'optional'

export type AskKind = 'question' | 'action'

export type Status = 'open' | 'drafted' | 'answered' | 'dropped'

export type ThreadEntry = { role: 'you' | 'claude' | 'note'; text: string }

export type Question = {
  id: string
  quote: string
  context: string
  /** The lines nearest the ask, from its own paragraph, that its card shows before `context` in full. */
  near?: string
  options: string[]
  recommended?: number
  priority: Priority
  kind: AskKind
  /** The language Claude wrote it in, an ISO 639-1 code; the panel's labels for it follow it. */
  lang?: string
  /** For a task, the commands it offers to copy, from the task and what follows it. */
  commands?: string[]
  status: Status
  askedAt: number
  askedAgainAt?: number
  /** How many messages the person sent since Claude last asked it; at three it moves to the older ones. */
  quiet?: number
  closedAt?: number
  /** `age` only in what one earlier build saved, which closed asks by their age; loading opens them again. */
  closedBy?: 'you' | 'agent' | 'age'
  answer?: string
  rowId: string
  thread: ThreadEntry[]
}

declare module 'claude-code' {
  interface PluginState {
    'loose-ends': {
      questions: Shaped<Question[]>
      expanded: string
      showDone: boolean
      showOlder: boolean
      busy: string[]
      paneShown: boolean
      picked: string
      /** The item whose card shows its side-chat field. */
      asking: string
      /** The item whose card shows all of its context. */
      full: string
    }
  }
}
