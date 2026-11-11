import type { AskKind, Priority, Question } from '../types'

/**
 * The question marks of the world's scripts: the one most scripts share, the
 * full-width one (Chinese, Japanese), Arabic, the Greek question mark (U+037E,
 * not the semicolon), Armenian, Ethiopic, and the inverted, reversed and
 * interrobang forms.
 */
const QUESTION_MARK = /[?？؟;՞፧¿⸮‽﹖︖]/u

/** Scripts written without spaces between words. */
const NO_SPACES = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u

/**
 * The agent's prose: its text without code blocks, inline code, link targets,
 * bare URLs and quoted lines, where a question mark asks the person nothing.
 */
export const proseOf = (text: string): string =>
  text
    .replace(/```[\s\S]*?(?:```|$)/g, ' ')
    .replace(/~~~[\s\S]*?(?:~~~|$)/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/\]\([^)]*\)/g, ']')
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, ' ')
    .replace(/^[ \t]*>.*$/gm, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/** Whether the agent's prose holds a question mark, in any script. No word lists, so no language is favoured. */
export const hasQuestionMark = (text: string): boolean => QUESTION_MARK.test(proseOf(text))

export const plain = (text: string): string =>
  text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\*\*|__|`/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim()

export const cut = (text: string, room: number): string => {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= room ? flat : flat.slice(0, Math.max(1, room - 1)).trimEnd() + '…'
}

export const clip = (text: string, room: number): string =>
  text.length <= room ? text : '…' + text.slice(text.length - room)

/** Characters a model may swap for one another when it copies text: quote styles and full-width punctuation. */
const SAME: readonly (readonly [RegExp, string, string])[] = [
  [/["„“”«»「」『』]/g, '"', '["„“”«»「」『』]'],
  [/['‘’‹›]/g, "'", "['‘’‹›]"],
  [/[?？]/g, '?', '[?？]'],
  [/[!！]/g, '!', '[!！]'],
  [/[,，、]/g, ',', '[,，、]'],
  [/[:：]/g, ':', '[:：]'],
  [/[;；]/g, ';', '[;；]'],
  [/[.。]/g, '.', '[.。]'],
]

export const norm = (text: string): string =>
  SAME.reduce((out, [all, one]) => out.replace(all, one), text.replace(/[*_`~]+/g, ''))
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()

const escapeChar = (ch: string): string => {
  for (const [all, , group] of SAME) {
    all.lastIndex = 0
    if (all.test(ch)) return group
  }
  return ch.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
}

const MD = '[*_`~]*'

const sentences = (text: string): string[] =>
  text
    .split(/\n+/)
    .flatMap(line => line.split(/(?<=[^\d\s][.?!…])\s+(?=\S)|(?<=[。！？])/))
    .map(part => part.trim())
    .filter(part => part.length > 0)

/** Words for the fallback match; in scripts with no spaces each character counts as one. */
const words = (text: string): string[] =>
  (norm(text).match(new RegExp(`${NO_SPACES.source}|(?:(?!${NO_SPACES.source})[\\p{L}\\p{N}])+`, 'gu')) ?? []).filter(
    w => w.length > 1 || NO_SPACES.test(w),
  )

/** A letter or digit of a script with spaces between words: only there does a match need a word boundary. */
const needsBoundary = (ch: string | undefined): boolean =>
  ch !== undefined && /[\p{L}\p{N}]/u.test(ch) && !NO_SPACES.test(ch)

/**
 * Finds `wanted` in `text` and answers the span exactly as `text` writes it,
 * so what the panel shows is always the agent's own words. Markdown marks,
 * case, quote styles and spacing may differ; the words may not. Falls back to
 * the one sentence of `text` that holds nearly all of the words.
 */
export const findVerbatim = (text: string, wanted: string): string | null => {
  const tokens = wanted
    .replace(/[*_`~]+/g, '')
    .split(/\s+/)
    .filter(t => t.length > 0)
  if (tokens.length === 0 || tokens.length > 400) return null

  const pattern = tokens.map(t => MD + [...t].map(ch => escapeChar(ch) + MD).join('')).join('\\s+')
  const first = [...(tokens[0] ?? '')][0]
  const last = [...(tokens.at(-1) ?? '')].at(-1)
  const before = needsBoundary(first) ? '(?<![\\p{L}\\p{N}])' : ''
  const after = needsBoundary(last) ? '(?![\\p{L}\\p{N}])' : ''
  const match = new RegExp(`${before}${pattern}${after}`, 'iu').exec(text)
  if (match) {
    const lineStart = text.lastIndexOf('\n', match.index) + 1
    const lead = text.slice(lineStart, match.index)
    return /^\s*(?:\d{1,2}[.)]|[-*•])\s+$/.test(lead) ? `${lead.trim()} ${match[0].trim()}` : match[0].trim()
  }

  const want = words(wanted)
  if (want.length < 3) return null
  let best: { score: number; sentence: string } | null = null
  for (const sentence of sentences(text)) {
    const have = new Set(words(sentence))
    const score = want.filter(w => have.has(w)).length / want.length
    if (score >= 0.85 && (best === null || score > best.score)) best = { score, sentence }
  }
  return best?.sentence ?? null
}

/** What may close a sentence after its mark: quotes, brackets and Markdown marks. */
const CLOSERS = '["”»\'’)\\]*_`]*'

/**
 * A sentence's end: a full stop, question or exclamation mark or ellipsis
 * after a letter (so not a list number such as `5.`) and before a space or
 * the line's end, or a full-width mark, which needs no space after it.
 */
const SENTENCE_END = new RegExp(`(?<=[^\\d\\s])[.?!…]${CLOSERS}(?=\\s|$)|[。！？]${CLOSERS}`, 'gu')

/**
 * `span`, a piece of `text`, widened to the whole sentences it stands in, on
 * its first and last line: a model that copies half a sentence ("and check
 * that…") gets the sentence, number and label in front included. The text
 * stays the agent's own; only where the quote starts and ends moves. A span
 * that is not found, or that would grow by more than 300 characters, stays.
 */
export const wholeSentences = (text: string, span: string): string => {
  const at = text.indexOf(span)
  if (at < 0 || span.length === 0) return span
  const lineStart = at === 0 ? 0 : text.lastIndexOf('\n', at - 1) + 1
  const spanEnd = at + span.length
  const newline = text.indexOf('\n', spanEnd)
  const lineEnd = newline < 0 ? text.length : newline

  let from = lineStart
  for (const m of text.slice(lineStart, at).matchAll(SENTENCE_END)) from = lineStart + m.index + m[0].length

  let to = spanEnd
  if (!new RegExp(`[.?!…。！？:：]${CLOSERS}$`, 'u').test(span)) {
    to = lineEnd
    const lastLineStart = text.lastIndexOf('\n', spanEnd - 1) + 1
    for (const m of text.slice(lastLineStart, lineEnd).matchAll(SENTENCE_END)) {
      const end = lastLineStart + m.index + m[0].length
      if (end > spanEnd) {
        to = end
        break
      }
    }
  }

  const whole = text.slice(from, to).trim()
  return whole.length - span.length > 300 ? span : whole
}

/**
 * The paragraph at `from`, and when it opens a fenced code block that a blank
 * line split, the paragraphs up to the fence that closes it.
 */
const followingBlock = (paragraphs: readonly string[], from: number): string => {
  const first = paragraphs[from] ?? ''
  const fence = /^(```|~~~)/.exec(first)?.[1]
  if (fence === undefined || (first.split('\n').length > 1 && first.trimEnd().endsWith(fence))) return first
  const block = [first]
  for (let at = from + 1; at < paragraphs.length; at += 1) {
    block.push(paragraphs[at] ?? '')
    if ((paragraphs[at] ?? '').trimEnd().endsWith(fence)) break
  }
  return block.join('\n\n')
}

const isCodeBlock = (paragraph: string): boolean => /^(```|~~~)/.test(paragraph) || /(```|~~~)\s*$/.test(paragraph)

type Around = { before: string; rest: string; after: string }

/**
 * What Claude wrote around the question, each part '' when left out:
 * - `before`, the paragraph before it, unless that is a code block, which
 *   belongs to whatever came before;
 * - `rest`, the rest of its own paragraph;
 * - `after`, the paragraph after it when the question announces it (it ends
 *   with a colon) or that paragraph is a code block, such as the command a
 *   task asks the person to run.
 */
const around = (text: string, quote: string): Around | null => {
  const paragraphs = text.split(/\n\s*\n/).map(p => p.trim()).filter(p => p.length > 0)
  const key = norm(quote).slice(0, 80)
  const at = paragraphs.findIndex(p => norm(p).includes(key))
  if (at < 0) return null
  const own = paragraphs[at] ?? ''
  const before = at > 0 ? (paragraphs[at - 1] ?? '') : ''
  const rest = own.includes(quote) ? own.replace(quote, ' ').replace(/[ \t]{2,}/g, ' ').trim() : ''
  const after = followingBlock(paragraphs, at + 1)
  const isAnnounced = /[:：]\s*$/.test(own) || /^(```|~~~)/.test(after)
  return {
    before: before.length > 0 && before.length < 900 && !isCodeBlock(before) ? before : '',
    rest: rest.replace(/[\s\p{P}]/gu, '').length >= 12 ? rest : '',
    after: isAnnounced && after.length < 1200 ? after : '',
  }
}

/** What Claude wrote around the question, without the question itself, which the panel already shows. */
export const contextFor = (text: string, quote: string): string => {
  const parts = around(text, quote)
  if (parts === null) return ''
  const context = [parts.before, parts.rest, parts.after].filter(part => part.length > 0).join('\n\n')
  return context.length > 1600 ? context.slice(0, 1599) + '…' : context
}

/**
 * The lines a card shows under the ask before its full context: the rest of
 * the ask's own paragraph when it says something (60 characters or more),
 * else the paragraph before it followed by that rest, else what follows.
 */
export const nearFor = (text: string, quote: string): string => {
  const parts = around(text, quote)
  if (parts === null) return ''
  if (parts.rest.length >= 60) return parts.rest
  return [parts.before, parts.rest].filter(part => part.length > 0).join('\n\n') || parts.after
}

/** The commands a task offers to copy: those in the task itself and in what follows it, never in what came before. */
export const commandsFor = (text: string, quote: string): string[] => {
  const parts = around(text, quote)
  return commandsIn([quote, parts?.rest ?? '', parts?.after ?? ''].join('\n\n'))
}

const cellsOf = (row: string): string[] =>
  row
    .trim()
    .replace(/^\|/, '')
    .replace(/(?<!\\)\|$/, '')
    .split(/(?<!\\)\|/)
    .map(cell => cell.trim())

const isTableRow = (line: string | undefined): boolean => line !== undefined && /^\s*\|.*\|\s*$/.test(line)

/**
 * The Markdown tables in `text` that are wider than `columns` cells, written
 * as a bold header line and one list item per row, the cells joined by ` · `.
 * A table drawn wider than its pane wraps into broken borders; this keeps
 * every word and only changes the layout. Tables that fit stay as they are.
 */
export const fitTables = (text: string, columns: number): string => {
  const lines = text.split('\n')
  const out: string[] = []
  let at = 0
  while (at < lines.length) {
    if (!isTableRow(lines[at]) || !/^\s*\|?\s*:?-{3,}/.test(lines[at + 1] ?? '')) {
      out.push(lines[at] ?? '')
      at += 1
      continue
    }
    let end = at + 2
    while (isTableRow(lines[end])) end += 1
    const rows = [lines[at] ?? '', ...lines.slice(at + 2, end)].map(cellsOf)
    const widths: number[] = []
    for (const row of rows) row.forEach((cell, i) => (widths[i] = Math.max(widths[i] ?? 0, [...cell].length)))
    const natural = widths.reduce((sum, w) => sum + w, 0) + 3 * widths.length + 1
    if (natural <= columns) out.push(...lines.slice(at, end))
    else {
      const [head = [], ...body] = rows
      const line = (row: string[]) => row.filter(cell => cell.length > 0).join(' · ')
      out.push(`**${line(head)}**`, '', ...body.map(row => `- ${line(row)}`))
    }
    at = end
  }
  return out.join('\n')
}

/**
 * Commands Claude wrote in or around a task, for a copy button: fenced code
 * blocks of up to three lines, and inline code that reads as a command (a
 * slash command, or a word and its arguments). A leading `$ ` is dropped.
 */
export const commandsIn = (text: string): string[] => {
  const found: string[] = []
  for (const m of text.matchAll(/```[^\n]*\n([\s\S]*?)```/g)) {
    const body = (m[1] ?? '').trim()
    if (body && body.split('\n').length <= 3) found.push(body)
  }
  const inline = text.replace(/```[\s\S]*?(?:```|$)/g, ' ')
  for (const m of inline.matchAll(/`([^`\n]+)`/g)) {
    const code = (m[1] ?? '').trim().replace(/^\$\s+/, '')
    if (/^\/[a-z][\w:-]*(\s|$)/i.test(code) || /^[a-z][\w.-]*\s+\S/.test(code)) found.push(code)
  }
  return [...new Set(found.map(c => c.replace(/^\$\s+/gm, '')))].slice(0, 3)
}

export const keepOptions = (text: string, options: readonly string[]): string[] => {
  const kept: string[] = []
  for (const option of options) {
    const found = findVerbatim(text, option)?.replace(/^(?:\d{1,2}[.)]|[-*•])\s+/, '')
    if (found && found.length <= 160 && !kept.some(k => norm(k) === norm(found))) kept.push(found)
  }
  return kept.slice(0, 9)
}

export const hasQuote = (text: string, quote: string): boolean => {
  const key = norm(quote).slice(0, 60)
  return key.length > 0 && norm(text).includes(key)
}

export const draftText = (quote: string, answer: string): string =>
  plain(quote)
    .split('\n')
    .map(line => '> ' + line)
    .join('\n') +
  '\n\n' +
  answer.trim()

/**
 * How an answer sent from the panel reads in the transcript: the answer, and
 * one line naming the question it answers, cut to `room` characters. Claude
 * still receives the whole message; this only draws the row smaller. Null
 * for any text the panel did not write.
 */
export const compactSent = (text: string, room = 90): string | null => {
  const sent = /^((?:> [^\n]*\n)+)\n([\s\S]+)$/.exec(text)
  if (sent === null) return null
  const quote = (sent[1] ?? '')
    .split('\n')
    .map(line => line.replace(/^> ?/, ''))
    .join(' ')
  const answer = (sent[2] ?? '').trim()
  return answer ? `${answer}\n↳ ${cut(quote, room)}` : null
}

export const EXTRACT_SYSTEM =`You read what an AI coding agent wrote to a person during a long working session, and you find what the agent is waiting on the person for now. You never answer the asks and you never reword them.

Answer with JSON only, no prose, in this shape:
{"new":[{"quote":"...","options":["..."],"recommended":"...","priority":"blocking","kind":"question","lang":"en"}],"resolved":[{"id":"q1","note":"..."}],"repeats":[{"id":"q1","quote":"..."}]}

What counts as an ask:
- a question the agent puts to the person: a decision, an approval, a preference, information it lacks;
- a task: a step only the person can take, which the work depends on or which the agent asks the person to take and report back on. Examples: run a command, sign in, approve something in a dashboard, test on a device, try something out and report back, or tell the agent once something is done. An imperative alone does not make a task: how-to tips and tidying suggestions the work does not depend on ("close the duplicate with d", "you can collapse it") are not tasks.
What does not count: rhetorical questions; questions the agent answers itself; questions quoted from the person or anyone else; anything inside code blocks or command output; questions addressed to a subagent; an offer to go on where going on is clearly the default; status reports and summaries, and a remark in them that something still needs deciding when the agent does not ask the person about it (when it asks later, that question is the ask); the steps of a plan or a list of next steps, the agent's own and the person's alike, while the agent is not waiting for that step now ("3. Deploy: I build the image and you push it"); reminders and checklists for a later stage ("before the launch, the pricing page needs new copy", "once it is merged, try it on a second laptop"); tips on how to use a tool or a screen ("close it with d"); a step left to the person's own choosing or timing that the agent does not wait for ("when you open X, tell me", "if you ever want Y, do Z").

quote: the ask copied exactly as it stands in the agent's text, character for character, in the same language, as a whole sentence or sentences, never a part of one, with any number or label in front of it. Never translate, shorten, merge or reword. One entry per separate ask, also when several sit in one numbered list; two parts of one sentence are one ask, and so is the same ask said twice in the new text (quote the fuller one). The exception is a procedure: steps the person is asked to follow one after another to do one thing ("1. do this, 2. then that") are one task, whose quote holds all of its steps in order.
options: only the choices the text itself spells out for that ask, each copied exactly; [] when it offers none. Never invent an option.
recommended: the option, copied exactly, that the text says it recommends or will take by default; leave the field out otherwise.
priority: "blocking" when the agent says it stops, waits or cannot go on without the answer or the step; "decision" when it goes on, or will, and asks the person to confirm or choose; "optional" for an offer or a nice-to-have.
kind: "action" for a task, even one phrased as a request ("try X, then tell me how it went"); "question" for everything else.
lang: the ISO 639-1 code of the language the quote itself is written in ("en", "sk", "de", ...), judged from the quote alone: the same text may switch languages from one ask to the next. Words without diacritics still count as their language.

resolved: ids from OPEN ASKS that the new text shows are settled: the agent says the person answered it, the agent did or decided it, it reports the outcome of the step (it was done, answered or decided, in any words, also by someone else on the person's behalf), or it no longer applies. Think of what each open ask was for: when the new text reports that result, the ask is settled even if the text never names the ask (an ask to answer another session is settled when that session reports it got its answers and acted). A mention of the same topic without a result is not enough. note: a short phrase copied from the new text that shows it.
repeats: an ask in the new text that is the same as one in OPEN ASKS, asked again and maybe reworded: its id and the new quote copied exactly. Do not put it in "new" as well. Judge sameness by what the person is asked to decide or do, using what was around each ask: the same command or decision asked again in other words is a repeat.

Empty lists when there is nothing.`

export const RESOLVE_SYSTEM = `You read a message a person sent to an AI coding agent and decide which of the agent's open asks it answers. Answer with JSON only: {"answered":[{"id":"q1","answer":"..."}]}

An ask is answered when the message gives the decision, the approval or the information, says the step is done, or says to drop, skip or postpone it. Numbered replies such as "1 yes, 2 later" refer to the numbering in the agent's last message, given below. Two open asks may ask the same thing in other words, such as a remark that something needs deciding and the direct question that followed it: when the message answers one, list each of them. answer: the part of the person's message that answers it, copied exactly. When unsure, leave the ask out. {"answered":[]} when the message answers none.`

/** An open ask as the small model sees it: its quote, and a little of what was around it, so a repeat is told apart. */
const openAsk = (q: Question): string =>
  q.context ? `${q.id}: ${cut(q.quote, 400)}\n    around it: ${cut(q.context, 240)}` : `${q.id}: ${cut(q.quote, 400)}`

export const buildExtractPrompt = (open: readonly Question[], text: string): string =>
  [
    'OPEN ASKS:',
    open.length === 0 ? '(none)' : open.map(openAsk).join('\n'),
    '',
    'NEW TEXT FROM THE AGENT:',
    '<<<',
    text,
    '>>>',
  ].join('\n')

export const buildResolvePrompt = (open: readonly Question[], agentText: string, personText: string): string =>
  [
    'OPEN ASKS:',
    open.map(openAsk).join('\n'),
    '',
    "THE AGENT'S LAST MESSAGE:",
    '<<<',
    agentText || '(not available)',
    '>>>',
    '',
    "THE PERSON'S MESSAGE:",
    '<<<',
    personText,
    '>>>',
  ].join('\n')

export const discussPrompt = (q: Question, ask: string): string => {
  const thread = q.thread
    .filter(entry => entry.role !== 'note')
    .map(entry => `${entry.role === 'you' ? 'The person' : 'You'}: ${entry.text}`)
    .join('\n\n')
  return [
    '[A side question from the person, asked in the loose-ends panel beside the chat. This exchange is not part of the main conversation, you have no tools here, and nothing you write here changes the work. Answer straight away, without deliberating at length, in plain words and in the language your question below is written in. Keep it under 180 words unless the person asks for more. Do not start any work and do not ask new questions back unless one is essential.]',
    '',
    `Your earlier question to the person: "${plain(q.quote)}"`,
    q.context && q.context !== q.quote ? `\nWhat you wrote around it:\n${q.context}` : '',
    thread ? `\nThe side discussion so far:\n${thread}` : '',
    '',
    `The person now asks: ${ask}`,
  ].join('\n')
}

export const EXPLAIN_ASK =
  'Explain this question in more detail: what exactly you need me to decide or do, the options and what each one leads to, and which one you recommend and why.'

type RawNew = {
  quote?: unknown
  options?: unknown
  recommended?: unknown
  priority?: unknown
  kind?: unknown
  lang?: unknown
}
type RawRef = { id?: unknown; note?: unknown; quote?: unknown; answer?: unknown }

export type Extracted = {
  found: { quote: string; options: string[]; recommended?: string; priority: Priority; kind: AskKind; lang?: string }[]
  resolved: { id: string; note: string }[]
  repeats: { id: string; quote: string }[]
}

const jsonIn = (reply: string): unknown => {
  const start = reply.indexOf('{')
  const end = reply.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(reply.slice(start, end + 1))
  } catch {
    return null
  }
}

const listOf = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
const str = (value: unknown): string => (typeof value === 'string' ? value : '')

/** A language tag cut to its primary subtag (`sk-SK` → `sk`); anything that is not a code is dropped. */
export const languageCode = (value: unknown): string | undefined => {
  const code = /^([a-z]{2,3})(?:[-_][a-z0-9]+)*$/i.exec(str(value).trim())?.[1]
  return code === undefined ? undefined : code.toLowerCase()
}

export const parseExtract = (reply: string): Extracted | null => {
  const data = jsonIn(reply) as { new?: unknown; resolved?: unknown; repeats?: unknown } | null
  if (data === null || typeof data !== 'object') return null
  const found = listOf(data.new).flatMap(item => {
    const raw = item as RawNew
    const quote = str(raw.quote).trim()
    if (!quote) return []
    const priority: Priority =
      raw.priority === 'blocking' || raw.priority === 'optional' ? raw.priority : 'decision'
    const kind: AskKind = raw.kind === 'action' ? 'action' : 'question'
    const options = listOf(raw.options).map(str).filter(o => o.trim().length > 0)
    const recommended = str(raw.recommended).trim()
    const lang = languageCode(raw.lang)
    return [{ quote, options, priority, kind, ...(recommended ? { recommended } : {}), ...(lang ? { lang } : {}) }]
  })
  const resolved = listOf(data.resolved).flatMap(item => {
    const raw = item as RawRef
    const id = str(raw.id)
    return id ? [{ id, note: str(raw.note) }] : []
  })
  const repeats = listOf(data.repeats).flatMap(item => {
    const raw = item as RawRef
    const id = str(raw.id)
    const quote = str(raw.quote)
    return id && quote ? [{ id, quote }] : []
  })
  return { found, resolved, repeats }
}

export const parseResolve = (reply: string): { id: string; answer: string }[] => {
  const data = jsonIn(reply) as { answered?: unknown } | null
  if (data === null || typeof data !== 'object') return []
  return listOf(data.answered).flatMap(item => {
    const raw = item as RawRef
    const id = str(raw.id)
    return id ? [{ id, answer: str(raw.answer) }] : []
  })
}

const RANK: Record<Priority, number> = { blocking: 0, decision: 1, optional: 2 }

export const isOpen = (q: Question): boolean => q.status === 'open' || q.status === 'drafted'

/** How many of the person's messages may go by without Claude asking again before an ask moves to the older ones. */
export const OLDER_AFTER = 3

/** An ask Claude has not asked again while the person sent three messages: still open, shown apart and folded. */
export const isOlder = (q: Question): boolean => q.status === 'open' && (q.quiet ?? 0) >= OLDER_AFTER

/** An ask that waits on the person now: open, and asked recently enough. */
export const isCurrent = (q: Question): boolean => isOpen(q) && !isOlder(q)

/**
 * The open asks that read the same once Markdown, case and quote styles are
 * set aside, all but the first dropped: a reworded ask matched to two old
 * ones, or asked twice, stays one item.
 */
export const mergeSame = (list: readonly Question[]): Question[] => {
  const seen = new Set<string>()
  return list.filter(q => {
    if (!isOpen(q)) return true
    const key = norm(q.quote)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** A message split into the lines it quotes (`> …`) and the rest, which is what the person wrote. */
export const quotedPart = (text: string): { quoted: string; rest: string } => {
  const lines = text.split('\n')
  const isQuoted = (line: string) => /^\s*>/.test(line)
  return {
    quoted: lines
      .filter(isQuoted)
      .map(line => line.replace(/^\s*>\s?/, ''))
      .join('\n')
      .trim(),
    rest: lines
      .filter(line => !isQuoted(line))
      .join('\n')
      .trim(),
  }
}

/**
 * Whether the lines a message quotes name this ask: they hold its start, or
 * a long enough piece of it. A reply that quotes the question it answers
 * settles that question without asking a model.
 */
export const quotesAsk = (quoted: string, q: Question): boolean => {
  if (!quoted) return false
  const said = norm(quoted)
  const ask = norm(q.quote)
  return said.includes(ask.slice(0, 60)) || (said.length >= 24 && ask.includes(said))
}

export const sortOpen = (list: readonly Question[]): Question[] =>
  list
    .filter(isOpen)
    .sort(
      (a, b) =>
        Number(a.status === 'drafted') - Number(b.status === 'drafted') ||
        RANK[a.priority] - RANK[b.priority] ||
        a.askedAt - b.askedAt,
    )

export const nextId = (list: readonly Question[]): string => {
  const top = list.reduce((most, q) => Math.max(most, Number(q.id.slice(1)) || 0), 0)
  return `q${top + 1}`
}

export const RELEASE =
  /\b(gh release create|npm publish|pnpm publish|yarn npm publish|cargo publish|git push\b[^\n]*--tags|git tag (?!-[ldn])\S)/
