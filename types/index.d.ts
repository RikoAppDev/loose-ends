export type Priority = 'blocking' | 'decision' | 'optional'

export type AskKind = 'question' | 'action'

export type Status = 'open' | 'drafted' | 'answered' | 'dropped'

export type ThreadEntry = { role: 'you' | 'claude' | 'note'; text: string }

export type Question = {
  id: string
  quote: string
  context: string
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
  closedAt?: number
  closedBy?: 'you' | 'agent'
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
      busy: string[]
      paneShown: boolean
      picked: string
    }
  }
}
