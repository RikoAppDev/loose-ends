import { atom, read, update } from 'claude-code'
import type { Color, EngineInterface, Register } from 'claude-code'

import type { Priority, Question, Status } from '../types'
import {
  EXPLAIN_ASK,
  EXTRACT_SYSTEM,
  RELEASE,
  RESOLVE_SYSTEM,
  buildExtractPrompt,
  buildResolvePrompt,
  clip,
  commandsFor,
  commandsIn,
  compactSent,
  contextFor,
  cut,
  discussPrompt,
  draftText,
  findVerbatim,
  fitTables,
  hasQuestionMark,
  hasQuote,
  isOlder,
  isOpen,
  keepOptions,
  mergeSame,
  nearFor,
  nextId,
  norm,
  OLDER_AFTER,
  parseExtract,
  parseResolve,
  plain,
  proseOf,
  quotedPart,
  quotesAsk,
  sortOpen,
  wholeSentences,
} from './extract'
import { ago, langOf, strings, uiLang } from './i18n'
import type { Lang, Strings } from './i18n'

const PANE = 'loose-ends'
const KEEP_SESSIONS = 40

const questions = atom({ plugin: 'loose-ends', key: 'questions' } as const, [], { shape: 'q-1' })
const expanded = atom({ plugin: 'loose-ends', key: 'expanded' } as const, '')
const showDone = atom({ plugin: 'loose-ends', key: 'showDone' } as const, false)
const showOlder = atom({ plugin: 'loose-ends', key: 'showOlder' } as const, false)
const busy = atom({ plugin: 'loose-ends', key: 'busy' } as const, [])
const paneShown = atom({ plugin: 'loose-ends', key: 'paneShown' } as const, false)
const picked = atom({ plugin: 'loose-ends', key: 'picked' } as const, '')
const asking = atom({ plugin: 'loose-ends', key: 'asking' } as const, '')
const full = atom({ plugin: 'loose-ends', key: 'full' } as const, '')

type Row = { rowId: string; text: string }

type Tones = Record<Priority | 'action' | 'accent' | 'ok', Color>

/**
 * On the terminal the panel paints with the 16 ANSI colors only, so it takes
 * the terminal's own palette, whatever its color scheme, and sets no
 * background anywhere. Other surfaces get Claude Code's theme keys.
 */
const tonesFor = (surface: string): Tones =>
  surface === 'terminal'
    ? { blocking: 'red', decision: 'yellow', optional: 'blue', action: 'magenta', accent: 'cyan', ok: 'green' }
    : { blocking: 'error', decision: 'warning', optional: 'suggestion', action: 'permission', accent: 'claude', ok: 'success' }

/**
 * The answer and side-chat fields have a fixed height of several rows. A
 * one-row field grows while the person types and drops back to one row at
 * the next redraw (a resize), cutting the text and leaving the cursor behind;
 * a fixed height keeps the text whole and scrolls it within.
 */
const ANSWER_ROWS = 2
const ASK_ROWS = 2

const GLYPH: Record<Priority, string> = { blocking: '●', decision: '◆', optional: '○' }
const TASK_GLYPH = '◉'

const isTask = (q: Question): boolean => q.kind === 'action'

/**
 * The waiting asks in the order the panel lists them: the current ones, then,
 * when asked for, the older ones; in each, questions before tasks, each by
 * priority and age.
 */
const ordered = (list: readonly Question[], withOlder = false): Question[] => {
  const open = sortOpen(list)
  const questionsFirst = (some: readonly Question[]) => [...some.filter(q => !isTask(q)), ...some.filter(isTask)]
  return [...questionsFirst(open.filter(q => !isOlder(q))), ...(withOlder ? questionsFirst(open.filter(isOlder)) : [])]
}

const config = { model: 'haiku', autoOpen: true, keepDoneMs: 24 * 3_600_000, language: 'auto', lang: 'en' as Lang }

let pending: Row[] = []
let flushTimer: { cancel: () => void } | undefined
let isFinalWanted = false
let chain: Promise<void> = Promise.resolve()
let turnText = ''
let lastAgentText = ''
let isFullscreen = false
let isAgentBusy = false
let sessionKey = ''
const drafts = new Map<string, string>()
const asks = new Map<string, string>()

/** A language for every label, when the `language` setting fixes one. */
const fixedLang = (): Lang | null => (config.language === 'en' || config.language === 'sk' ? config.language : null)

/**
 * The labels for one question or task, in the language Claude wrote it in, so
 * a chat that switches languages gets each item's labels in its own. The
 * setting may fix one; an item of unknown language gets the fallback.
 */
const labelsFor = (q: { lang?: string } | undefined): Strings => strings(fixedLang() ?? langOf(q?.lang, config.lang))

const newest = (list: readonly Question[]): Question | undefined =>
  list.reduce<Question | undefined>(
    (last, q) => (last === undefined || (q.askedAgainAt ?? q.askedAt) >= (last.askedAgainAt ?? last.askedAt) ? q : last),
    undefined,
  )

/** The labels for the panel as a whole, the band and the status line: the language of what Claude asked last. */
const labelsOf = (list: readonly Question[]): Strings => labelsFor(newest(list.filter(isOpen)) ?? newest(list))

async function pickLanguage($: EngineInterface): Promise<void> {
  if (config.language === 'en' || config.language === 'sk') {
    config.lang = config.language
    return
  }
  try {
    const claudeLanguage = await $.settings.read({ key: 'language' })
    const locale = (await $.env.get('LC_ALL')) || (await $.env.get('LC_MESSAGES')) || (await $.env.get('LANG'))
    config.lang = uiLang(config.language, claudeLanguage, locale)
  } catch {
    config.lang = 'en'
  }
}

function debug($: EngineInterface, text: string): void {
  try {
    $.ui.log(`loose-ends: ${text}`, { to: 'debug' })
  } catch {
    return
  }
}

function run($: EngineInterface, job: () => Promise<void>): void {
  chain = chain.then(job).catch((err: unknown) => {
    debug($, err instanceof Error ? err.message : String(err))
  })
}

function later($: EngineInterface, job: () => Promise<void>): void {
  $.clock.after(1, () => run($, job))
}

/**
 * What the mod adds, dim, to the end of the hint line under the prompt: its
 * command and what waits. Always there, so the mod is easy to find with
 * nothing open, and as quiet as the rest of that line.
 */
function hintTail(list: readonly Question[]): string {
  const L = labelsOf(list)
  const waiting = list.filter(q => q.status === 'open' && !isOlder(q))
  const tasks = waiting.filter(isTask).length
  return ` · ${waiting.length > 0 ? L.hint(waiting.length - tasks, tasks) : L.hintClear}`
}

async function save($: EngineInterface): Promise<void> {
  const list = await read($, questions)
  if (!sessionKey) return
  await $.store.set(sessionKey, { savedAt: await $.clock.now(), list })
}

async function mutate($: EngineInterface, change: (list: Question[]) => Question[]): Promise<void> {
  await update($, questions, change)
  await save($)
}

async function setStatus($: EngineInterface, id: string, status: Status, answer?: string): Promise<void> {
  const now = await $.clock.now()
  await mutate($, list =>
    list.map(q => {
      if (q.id !== id) return q
      if (status === 'open') {
        const { closedAt: _c, closedBy: _b, answer: _a, ...rest } = q
        return { ...rest, status, quiet: 0 }
      }
      return {
        ...q,
        status,
        ...(status === 'drafted' ? {} : { closedAt: now, closedBy: 'you' as const }),
        ...(answer !== undefined ? { answer } : {}),
      }
    }),
  )
  if (status !== 'open') {
    await update($, expanded, current => (current === id ? '' : current))
    await update($, picked, current => (current.startsWith(`${id}:`) ? '' : current))
  }
}

async function prune($: EngineInterface): Promise<void> {
  const keys = (await $.store.keys()).filter(key => key.startsWith('s:'))
  if (keys.length <= KEEP_SESSIONS) return
  const dated: { key: string; at: number }[] = []
  for (const key of keys) {
    const saved = (await $.store.get(key)) as { savedAt?: number } | undefined
    dated.push({ key, at: Number(saved?.savedAt ?? 0) })
  }
  dated.sort((a, b) => b.at - a.at)
  for (const { key } of dated.slice(KEEP_SESSIONS)) await $.store.delete(key)
}

/**
 * Once a minute: finished items older than the `keepDoneHours` setting leave
 * the finished list. An open ask never closes because time went by, however
 * long the work pauses; only an answer, a done step or the person closes it.
 */
async function expire($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  const list = await read($, questions)
  const isGone = (q: Question) => !isOpen(q) && now - (q.closedAt ?? now) >= config.keepDoneMs
  if (list.some(isGone)) await mutate($, current => current.filter(q => !isGone(q)))
  else if (list.some(isOpen)) $.ui.invalidate('ui.render')
}

/**
 * Asks saved by an earlier version: twins merged, and any ask a build that
 * closed asks by their age closed that way opened again, among the older ones.
 */
async function settleSaved($: EngineInterface): Promise<void> {
  const list = await read($, questions)
  const isAged = (q: Question) => q.status === 'dropped' && q.closedBy === 'age'
  if (!list.some(isAged) && mergeSame(list).length === list.length) return
  await mutate($, current =>
    mergeSame(
      current.map(q => {
        if (!isAged(q)) return q
        const { closedAt: _c, closedBy: _b, ...rest } = q
        return { ...rest, status: 'open' as const, quiet: OLDER_AFTER }
      }),
    ),
  )
}

async function clearDone($: EngineInterface): Promise<void> {
  await mutate($, list => list.filter(isOpen))
}

async function openPane($: EngineInterface, isAsked: boolean): Promise<void> {
  const title = labelsOf(await read($, questions)).title
  const opened = await $.ui.open({ id: PANE, title, ...(isAsked ? { focus: true } : {}) })
  if (opened.isPlaced) await update($, paneShown, () => true)
}

/** Unfolds the next or previous waiting ask, in the order the panel lists them. */
async function step($: EngineInterface, by: 1 | -1): Promise<void> {
  const order = ordered(await read($, questions), await read($, showOlder)).map(q => q.id)
  if (order.length === 0) return
  await update($, expanded, current => {
    const at = order.indexOf(current)
    const next = at < 0 ? (by === 1 ? 0 : order.length - 1) : (at + by + order.length) % order.length
    return order[next] ?? ''
  })
}

/** A digit only picks an option; sending it takes a second, deliberate key, so a stray key sends nothing. */
async function pick($: EngineInterface, id: string, at: number): Promise<void> {
  await update($, picked, current => (current === `${id}:${at}` ? '' : `${id}:${at}`))
}

/** Puts the cursor in one of the panel's fields; a surface that cannot only leaves a line in the debug log. */
async function focusOn($: EngineInterface, key: string): Promise<void> {
  try {
    const moved = await $.ui.focus({ requestId: PANE, key })
    if (moved.deny !== undefined) debug($, `focus ${key}: ${moved.deny}`)
  } catch (err) {
    debug($, `focus ${key}: ${err instanceof Error ? err.message : String(err)}`)
  }
}

async function reply($: EngineInterface, id: string): Promise<void> {
  await focusOn($, `ans:${id}`)
}

/** Shows the side-chat field under an item, which is hidden until asked for, and puts the cursor in it once drawn. */
async function openSide($: EngineInterface, id: string): Promise<void> {
  await update($, asking, () => id)
  $.clock.after(1, () => void focusOn($, `ask:${id}`))
}

type Surface = Parameters<EngineInterface['ui']['copy']>[0]['surface']

async function copyCommand($: EngineInterface, text: string, surface: Surface, L: Strings): Promise<void> {
  await $.ui.copy({ text, surface })
  $.ui.toast(L.copied)
}

/**
 * When the small model reads the agent's text, by two fixed rules that hold in
 * every language: a batch whose prose has a question mark is read after 8 s of
 * quiet, while the turn runs; any other text waits and is read once, when the
 * turn ends. A request with no question mark ("run this and tell me") is so
 * caught at the turn's end at the latest.
 */
function schedule($: EngineInterface, ms: number, isFinal: boolean): void {
  isFinalWanted = isFinalWanted || isFinal
  flushTimer?.cancel()
  flushTimer = $.clock.after(ms, () => {
    flushTimer = undefined
    flushNow($)
  })
}

function flushNow($: EngineInterface): void {
  flushTimer?.cancel()
  flushTimer = undefined
  const isFinal = isFinalWanted
  isFinalWanted = false
  run($, () => flush($, isFinal))
}

async function flush($: EngineInterface, isFinal: boolean): Promise<void> {
  if (pending.length === 0) return
  const text = pending.map(row => row.text).join('\n\n')
  if (!isFinal && !hasQuestionMark(text)) return
  const batch = pending
  pending = []
  if (proseOf(text) === '') return
  const open = (await read($, questions)).filter(isOpen)

  const response = await $.model.complete({
    model: config.model,
    system: EXTRACT_SYSTEM,
    prompt: buildExtractPrompt(open, clip(text, 14_000)),
    maxTokens: 2000,
    timeoutMs: 90_000,
  })
  if (!response.isAnswered) {
    debug($, `finding questions skipped: ${response.reason}`)
    return
  }
  const out = parseExtract(response.text)
  if (out === null) {
    debug($, 'finding questions: the reply held no JSON')
    return
  }

  const now = await $.clock.now()
  const rowOf = (quote: string) =>
    batch.find(row => findVerbatim(row.text, quote) !== null)?.rowId ?? batch.at(-1)?.rowId ?? ''
  const askedAgain = new Map(out.repeats.map(r => [r.id, r.quote]))
  const fresh: Omit<Question, 'id'>[] = []
  for (const item of out.found) {
    const found = findVerbatim(text, item.quote)
    if (found === null) continue
    const quote = wholeSentences(text, found)
    const same = open.find(q => norm(q.quote) === norm(quote))
    if (same !== undefined) {
      if (!askedAgain.has(same.id)) askedAgain.set(same.id, quote)
      continue
    }
    if (fresh.some(q => norm(q.quote) === norm(quote))) continue
    const options = keepOptions(text, item.options)
    const recommended = item.recommended ? findVerbatim(text, item.recommended) : null
    const at = recommended === null ? -1 : options.findIndex(o => norm(o) === norm(recommended))
    fresh.push({
      quote,
      context: contextFor(text, quote),
      near: nearFor(text, quote),
      ...(item.kind === 'action' ? { commands: commandsFor(text, quote) } : {}),
      options,
      ...(at >= 0 ? { recommended: at } : {}),
      priority: item.priority,
      kind: item.kind,
      ...(item.lang ? { lang: item.lang } : {}),
      status: 'open',
      askedAt: now,
      quiet: 0,
      rowId: rowOf(quote),
      thread: [],
    })
  }

  const settled = new Map(out.resolved.map(r => [r.id, r.note]))
  if (fresh.length === 0 && settled.size === 0 && askedAgain.size === 0) return

  await mutate($, list => {
    const kept = list.map(q => {
      if (!isOpen(q)) return q
      if (settled.has(q.id)) {
        const note = findVerbatim(text, settled.get(q.id) ?? '') ?? ''
        return { ...q, status: 'answered' as const, closedAt: now, closedBy: 'agent' as const, answer: note }
      }
      const again = askedAgain.get(q.id)
      const found = again === undefined ? null : findVerbatim(text, again)
      if (found !== null) {
        const quote = wholeSentences(text, found)
        return {
          ...q,
          quote,
          context: contextFor(text, quote),
          near: nearFor(text, quote),
          ...(isTask(q) ? { commands: commandsFor(text, quote) } : {}),
          rowId: rowOf(quote),
          askedAgainAt: now,
          quiet: 0,
        }
      }
      return q
    })
    const added: Question[] = []
    for (const item of fresh) added.push({ ...item, id: nextId([...kept, ...added]) })
    return mergeSame([...kept, ...added])
  })

  if (fresh.length > 0) {
    $.ui.toast(labelsFor(fresh.at(-1)).newOne(fresh.length))
    if (config.autoOpen && isFullscreen) await openPane($, false)
  }
}

async function resolveFrom($: EngineInterface, text: string): Promise<void> {
  const list = await read($, questions)
  const open = list.filter(q => q.status === 'open')
  if (open.length === 0 && !list.some(q => q.status === 'drafted')) return

  const { quoted, rest } = quotedPart(text)
  const byQuote = new Set(open.filter(q => quotesAsk(quoted, q)).map(q => q.id))

  let answered: { id: string; answer: string }[] = []
  if (open.length > 0) {
    const response = await $.model.complete({
      model: config.model,
      system: RESOLVE_SYSTEM,
      prompt: buildResolvePrompt(open, clip(lastAgentText, 6000), clip(text, 6000)),
      maxTokens: 800,
      timeoutMs: 60_000,
    })
    if (response.isAnswered) answered = parseResolve(response.text)
    else debug($, `matching answers skipped: ${response.reason}`)
  }

  const now = await $.clock.now()
  await mutate($, current =>
    current.map(q => {
      if (q.status === 'drafted') {
        if (hasQuote(text, q.quote)) return { ...q, status: 'answered' as const, closedAt: now, closedBy: 'you' as const }
        const { answer: _a, ...rest } = q
        return { ...rest, status: 'open' as const, quiet: q.quiet ?? 0 }
      }
      if (q.status !== 'open') return q
      const hit = answered.find(a => a.id === q.id)
      if (hit === undefined && !byQuote.has(q.id)) return { ...q, quiet: (q.quiet ?? 0) + 1 }
      return {
        ...q,
        status: 'answered' as const,
        closedAt: now,
        closedBy: 'you' as const,
        answer: hit === undefined ? rest : (findVerbatim(text, hit.answer) ?? ''),
      }
    }),
  )
}

/**
 * Sends the answer as the person's own message, quoting the question. A
 * plugin's message waits for the session to be idle, so one sent while
 * Claude works reaches it when the turn ends; the toast says which.
 */
async function send($: EngineInterface, id: string, answer: string): Promise<void> {
  const said = answer.trim()
  if (!said) return
  const q = (await read($, questions)).find(one => one.id === id)
  if (q === undefined) return
  const L = labelsFor(q)
  drafts.delete(id)
  await setStatus($, id, 'answered', said)
  $.ui.toast(isAgentBusy ? L.queued : L.sent)
  const text = draftText(q.quote, said)
  $.clock.after(1, () => {
    void deliver($, id, text, L)
  })
}

async function deliver($: EngineInterface, id: string, text: string, L: Strings): Promise<void> {
  const why = await $.prompt.submit({ text, asUser: true }).then(
    sent => sent.drop,
    (err: unknown) => (err instanceof Error ? err.message : String(err)) || 'refused',
  )
  if (why === undefined) return
  run($, async () => {
    await setStatus($, id, 'open')
    $.ui.toast(L.notSent(why))
  })
}

/** Puts the quoted question, and what is typed so far, in the prompt box to edit or send with other text. */
async function toPrompt($: EngineInterface, id: string, answer: string): Promise<void> {
  const list = await read($, questions)
  const q = list.find(one => one.id === id)
  if (q === undefined) return
  const L = labelsFor(q)
  const block = draftText(q.quote, answer)
  const box = await $.prompt.read()
  const filled = await $.prompt.fill(
    box.text.trim() ? { text: `\n\n${block}`, mode: 'append' } : { text: block, mode: 'replace' },
  )
  if (!filled.isFilled) {
    await $.ui.copy({ text: block })
    $.ui.toast(L.noFill)
    return
  }
  drafts.delete(id)
  await setStatus($, id, 'drafted', answer.trim() || undefined)
  $.ui.toast(L.drafted)
}

async function discuss($: EngineInterface, id: string, ask: string): Promise<void> {
  const list = await read($, questions)
  const q = list.find(one => one.id === id)
  if (q === undefined) return
  const L = labelsFor(q)
  const said = ask.trim()
  asks.delete(id)
  const prompt = discussPrompt(q, said || EXPLAIN_ASK)
  await mutate($, current =>
    current.map(one =>
      one.id === id ? { ...one, thread: [...one.thread, { role: 'you' as const, text: said || L.explain }] } : one,
    ),
  )
  await update($, busy, ids => [...ids.filter(other => other !== id), id])
  later($, () => answerSide($, id, prompt, L))
}

async function answerSide($: EngineInterface, id: string, prompt: string, L: Strings): Promise<void> {
  let text = ''
  const forked = await $.model.fork({ prompt })
  if (forked.isAnswered) text = forked.text.trim()
  else {
    debug($, `side chat fork: ${forked.reason}`)
    const alone = await $.model.complete({ model: config.model, prompt, maxTokens: 1200, timeoutMs: 90_000 })
    text = alone.isAnswered ? `${alone.text.trim()}\n\n_${L.noFork}_` : `(${alone.reason})`
  }
  await mutate($, current =>
    current.map(one => (one.id === id ? { ...one, thread: [...one.thread, { role: 'claude' as const, text }] } : one)),
  )
  await update($, busy, ids => ids.filter(other => other !== id))
}

async function loadSaved($: EngineInterface): Promise<void> {
  sessionKey = `s:${await $.session.id()}`
  if ((await read($, questions)).length > 0) return
  const saved = (await $.store.get(sessionKey)) as { list?: Question[] } | undefined
  const list = Array.isArray(saved?.list) ? saved.list : []
  if (list.length > 0) await update($, questions, () => list)
}

export const register: Register = (on, options) => {
  config.model = typeof options.model === 'string' && options.model.trim() ? options.model.trim() : 'haiku'
  config.autoOpen = options.autoOpen !== false
  config.keepDoneMs = Math.max(1, Number(options.keepDoneHours ?? 24) || 24) * 3_600_000
  config.language = typeof options.language === 'string' ? options.language : 'auto'

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'loose-ends',
      description: 'Show the questions and tasks Claude left for you (clear: drop finished ones)',
    })
    await pickLanguage($)
    await loadSaved($)
    await settleSaved($)
    await prune($)
    $.clock.every(60_000, () => run($, () => expire($)))
    return next(e)
  })

  on('turn.start', ($, e, next) => {
    if (e.agentId === undefined) {
      turnText = ''
      isAgentBusy = true
    }
    return next(e)
  })

  on('session.append', { door: 'response' }, async ($, e, next) => {
    const stored = await next(e)
    if (e.agentId !== undefined || e.message.type !== 'assistant') return stored
    const text = e.message.content
      .flatMap(block => (block.type === 'text' && 'text' in block && typeof block.text === 'string' ? [block.text] : []))
      .join('\n')
      .trim()
    if (text) {
      pending.push({ rowId: e.uuid, text })
      turnText = turnText ? `${turnText}\n\n${text}` : text
      lastAgentText = turnText
      schedule($, 8000, false)
    }
    return stored
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) {
      isAgentBusy = false
      if (pending.length > 0) schedule($, 300, true)
    }
    return result
  })

  on('prompt.submit', async ($, e, next) => {
    const result = await next(e)
    const kind = e.origin?.kind
    if (result.drop !== undefined || e.command !== undefined || e.isMeta) return result
    if (kind !== 'composer' && kind !== 'bridge') return result
    const text = e.text
    $.clock.after(1, () => flushNow($))
    later($, () => resolveFrom($, text))
    return result
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && ran.isError !== true && RELEASE.test(String(e.command ?? ''))) {
      later($, () => clearDone($))
    }
    return ran
  })

  on('command.run', { command: 'loose-ends' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    const L = labelsOf(await read($, questions))
    if (arg === 'clear') {
      await clearDone($)
      $.ui.toast(L.cleared)
      return {}
    }
    if (arg === 'reset') {
      await mutate($, () => [])
      $.ui.toast(L.reset)
      return {}
    }
    await openPane($, true)
    return {}
  })

  on('ui.close', { id: PANE }, async ($, e, next) => {
    const result = await next(e)
    await update($, paneShown, () => false)
    return result
  }).catch(($, e, next) => next(e))

  // An answer sent from the panel reads as the answer and one line naming the question; ctrl+o shows it whole.
  on('ui.render', { component: 'UserMessage' }, ($, e, next) => {
    const origin = e.props.origin
    if (e.props.isExpanded || origin.kind !== 'plugin' || origin.name !== PANE) return next(e)
    const text = compactSent(e.props.text)
    return next(text === null ? e : { ...e, props: { ...e.props, text } })
  })

  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const tail = hintTail(await read($, questions))
    return next({ ...e, props: { ...e.props, tail: `${e.props.tail ?? ''}${tail}` } })
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.viewport?.isFullscreen !== undefined) isFullscreen = e.viewport.isFullscreen
    const list = await read($, questions)
    const isPaneUp = await read($, paneShown)
    const waiting = sortOpen(list).filter(q => q.status === 'open' && !isOlder(q))
    const top = waiting[0]
    if (e.props.hasSurvey || top === undefined || isPaneUp) return next(e)

    const { Box, Text, Button } = $.ui.resolve(e)
    const L = labelsFor(top)
    const tone = tonesFor(e.surface)
    const tasks = waiting.filter(isTask).length
    const head = L.waiting(waiting.length - tasks, tasks)
    const room = Math.max(12, e.props.bodyColumns - head.length - L.show.length - 12)
    const below = await next(e)

    return (
      <Box flexDirection="column">
        {below}
        <Box flexDirection="row" columnGap={1}>
          <Text color={isTask(top) ? tone.action : tone[top.priority]}>{isTask(top) ? TASK_GLYPH : GLYPH[top.priority]}</Text>
          <Text bold>{head}</Text>
          <Text dimColor>{`· ${cut(plain(top.quote), room)}`}</Text>
          <Button key="show" plain label={L.show} onPress={() => void openPane($, true)} />
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Input, Markdown } = $.ui.resolve(e)
    const list = await read($, questions)
    const current = await read($, expanded)
    const isDoneShown = await read($, showDone)
    const isOlderShown = await read($, showOlder)
    const thinking = await read($, busy)
    const choice = await read($, picked)
    const askingId = await read($, asking)
    const fullId = await read($, full)
    const now = await $.clock.now()
    const L = labelsOf(list)
    const tone = tonesFor(e.surface)
    const width = Math.max(24, e.props.bodyColumns)
    /** Cells inside an unfolded item's card: its round border and padding take four. */
    const inner = width - 4
    const open = ordered(list, true)
    const fresh = open.filter(q => !isOlder(q))
    const older = open.filter(isOlder)
    const asked = fresh.filter(q => !isTask(q))
    const todo = fresh.filter(isTask)
    const done = list.filter(q => !isOpen(q)).sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0))
    const colorOf = (q: Question): Color => (isTask(q) ? tone.action : tone[q.priority])
    const glyphOf = (q: Question): string => (q.status === 'drafted' ? '✎' : isTask(q) ? TASK_GLYPH : GLYPH[q.priority])
    const ageOf = (q: Question): string => ago(now - (q.askedAgainAt ?? q.askedAt))
    const toggle = (q: Question) => () => void update($, expanded, at => (at === q.id ? '' : q.id))

    const waiting = fresh.filter(q => q.status === 'open')
    const counts = [
      ...(['blocking', 'decision', 'optional'] as const).map(p => ({
        mark: GLYPH[p],
        color: tone[p],
        n: waiting.filter(q => !isTask(q) && q.priority === p).length,
      })),
      { mark: TASK_GLYPH, color: tone.action, n: waiting.filter(isTask).length },
    ].filter(c => c.n > 0)

    const header = (
      <Box flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between">
          <Text bold>{L.heading}</Text>
          {counts.length === 0 ? (
            <Text color={tone.ok}>✓</Text>
          ) : (
            <Box flexDirection="row" columnGap={2}>
              {counts.map(c => (
                <Text color={c.color}>{`${c.mark} ${c.n}`}</Text>
              ))}
            </Box>
          )}
        </Box>
        <Text dimColor>{'─'.repeat(width)}</Text>
      </Box>
    )

    const empty = (
      <Box flexDirection="column" marginTop={1} paddingLeft={1}>
        <Text color={tone.ok}>{`✓ ${L.allClear}`}</Text>
        {list.length === 0 ? <Text dimColor>{L.emptyHint}</Text> : null}
      </Box>
    )

    /** One line per item: its mark, its words cut to the width, and how long ago Claude asked it. */
    const row = (q: Question, isDim = false) => {
      const age = ageOf(q)
      const isMuted = isDim || q.status === 'drafted'
      return (
        <Box flexDirection="row" justifyContent="space-between" columnGap={1}>
          <Button key={`row:${q.id}`} plain onPress={toggle(q)}>
            <Text color={colorOf(q)} dimColor={isMuted}>{`${glyphOf(q)} `}</Text>
            <Text dimColor={isMuted}>{cut(plain(q.quote), Math.max(8, width - age.length - 4))}</Text>
          </Button>
          <Box flexShrink={0}>
            <Text dimColor>{age}</Text>
          </Box>
        </Box>
      )
    }

    const section = (title: string, items: readonly Question[]) =>
      items.length === 0 ? null : (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>
            {title}
            <Text dimColor>{` · ${items.length}`}</Text>
          </Text>
          {items.map(q => (q.id === current ? card(q) : row(q)))}
        </Box>
      )

    // Each item below draws its own labels, in its own language.
    const options = (q: Question) => {
      if (q.options.length === 0) return null
      const L = labelsFor(q)
      const chosen = choice.startsWith(`${q.id}:`) ? Number(choice.slice(q.id.length + 1)) : -1
      const pickedText = chosen >= 0 ? q.options[chosen] : undefined
      return (
        <Box flexDirection="column">
          {q.options.slice(0, 9).map((option, at) => (
            <Box flexDirection="row" columnGap={1}>
              <Button
                key={`opt:${q.id}:${at}`}
                plain
                hotkey={String(at + 1)}
                label={cut(plain(option), Math.max(12, width - 20))}
                onPress={() => void pick($, q.id, at)}
              />
              {chosen === at ? <Text color={tone.accent} bold>{`◂ ${L.picked}`}</Text> : null}
              {q.recommended === at && chosen !== at ? <Text color={tone.accent}>{`★ ${L.recommended}`}</Text> : null}
            </Box>
          ))}
          {pickedText !== undefined ? (
            <Box marginTop={1}>
              <Button
                key={`send:${q.id}`}
                plain
                hotkey="s"
                label={`${L.send}: ${cut(plain(pickedText), Math.max(12, width - 16))}`}
                onPress={() => void send($, q.id, plain(pickedText))}
              />
            </Box>
          ) : null}
        </Box>
      )
    }

    const copies = (q: Question) => {
      const commands = isTask(q) ? (q.commands ?? commandsIn(q.quote)) : []
      if (commands.length === 0) return null
      const L = labelsFor(q)
      return (
        <Box flexDirection="column">
          {commands.map((command, at) => (
            <Button
              key={`copy:${q.id}:${at}`}
              plain
              {...(at === 0 ? { hotkey: 'c' } : {})}
              label={`${L.copy}: ${cut(command, Math.max(12, width - 16))}`}
              onPress={() => void copyCommand($, command, e.surface, L)}
            />
          ))}
        </Box>
      )
    }

    const actions = (q: Question, hasMore: boolean) => {
      const L = labelsFor(q)
      return (
        <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
          <Button
            key={`answered:${q.id}`}
            plain
            hotkey="d"
            label={isTask(q) ? L.markDone : L.markAnswered}
            onPress={() => void setStatus($, q.id, 'answered')}
          />
          <Button key={`drop:${q.id}`} plain hotkey="x" label={L.drop} onPress={() => void setStatus($, q.id, 'dropped')} />
          {hasMore ? (
            <Button
              key={`more:${q.id}`}
              plain
              hotkey="m"
              label={fullId === q.id ? L.less : L.more}
              onPress={() => void update($, full, at => (at === q.id ? '' : q.id))}
            />
          ) : null}
          <Button key={`side:${q.id}`} plain hotkey="e" label={L.ask} onPress={() => void openSide($, q.id)} />
          <Button key={`reply:${q.id}`} plain hotkey="r" label={L.reply} onPress={() => void reply($, q.id)} />
          <Button
            key={`prompt:${q.id}`}
            plain
            hotkey="p"
            label={L.toPrompt}
            onPress={() => void toPrompt($, q.id, drafts.get(q.id) ?? '')}
          />
        </Box>
      )
    }

    /** The side chat: what was asked and answered here, and its field once asked for. */
    const side = (q: Question) => {
      const L = labelsFor(q)
      const isThinking = thinking.includes(q.id)
      const isAsking = askingId === q.id
      if (q.thread.length === 0 && !isThinking && !isAsking) return null
      return (
        <Box flexDirection="column" rowGap={1}>
          {q.thread.length > 0 ? <Text dimColor>{`┄ ${L.sideChat}`}</Text> : null}
          {q.thread.map(entry =>
            entry.role === 'claude' ? (
              <Box flexDirection="column">
                <Text color={tone.accent}>{L.claude}</Text>
                <Markdown text={fitTables(entry.text, inner)} />
              </Box>
            ) : (
              <Text>
                <Text dimColor>{`${L.you}  `}</Text>
                {entry.text}
              </Text>
            ),
          )}
          {isThinking ? <Text dimColor>{L.thinking}</Text> : null}
          {isAsking ? (
            <Input
              key={`ask:${q.id}`}
              rows={ASK_ROWS}
              placeholder={`? ${L.askHint}`}
              value={asks.get(q.id) ?? ''}
              submitLabel="↵"
              onInput={value => {
                asks.set(q.id, value)
              }}
              onSubmit={value => void discuss($, q.id, value)}
            />
          ) : null}
        </Box>
      )
    }

    /**
     * An unfolded item: the ask whole, at most three lines of what stood
     * around it (m shows all of it), its options, the answer field and one
     * row of keys.
     */
    const card = (q: Question) => {
      const L = labelsFor(q)
      const near = plain(q.near ?? q.context.split(/\n\s*\n/).at(-1) ?? '')
      const brief = cut(near, Math.max(40, inner * 3 - 6))
      const isFull = fullId === q.id
      const hasMore = q.context.replace(/\s+/g, ' ').trim().length > brief.length + 8
      return (
        <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor={colorOf(q)} paddingX={1} rowGap={1}>
          <Box flexDirection="row" justifyContent="space-between" columnGap={1}>
            <Box flexShrink={1}>
              <Button key={`row:${q.id}`} plain onPress={toggle(q)}>
                <Text color={colorOf(q)}>{`${glyphOf(q)} `}</Text>
                <Text bold>{plain(q.quote)}</Text>
              </Button>
            </Box>
            <Box flexShrink={0}>
              <Text dimColor>{ageOf(q)}</Text>
            </Box>
          </Box>
          {isFull && q.context ? (
            <Markdown text={fitTables(q.context, inner)} dimColor />
          ) : brief ? (
            <Text dimColor>{brief}</Text>
          ) : null}
          {options(q)}
          <Input
            key={`ans:${q.id}`}
            rows={ANSWER_ROWS}
            placeholder={`› ${isTask(q) ? L.replyHint : L.answerHint}`}
            value={drafts.get(q.id) ?? ''}
            submitLabel={L.send}
            onInput={value => {
              drafts.set(q.id, value)
            }}
            onSubmit={value => void send($, q.id, value)}
          />
          {copies(q)}
          {actions(q, hasMore)}
          {side(q)}
        </Box>
      )
    }

    const closed = (q: Question) => {
      const L = labelsFor(q)
      const how =
        q.status === 'dropped'
          ? L.dropped
          : q.closedBy === 'agent'
            ? L.settled
            : isTask(q)
              ? L.finished
              : L.answered
      const room = Math.max(10, width - how.length - L.reopen.length - 10)
      return (
        <Box flexDirection="row" justifyContent="space-between" columnGap={1} paddingLeft={1}>
          <Text dimColor>
            {q.status === 'dropped' ? <Text>{'✕ '}</Text> : <Text color={tone.ok}>{'✓ '}</Text>}
            {`${cut(plain(q.quote), room)} · ${how}`}
          </Text>
          <Box flexShrink={0}>
            <Button key={`reopen:${q.id}`} plain dimColor label={L.reopen} onPress={() => void setStatus($, q.id, 'open')} />
          </Box>
        </Box>
      )
    }

    const fold = (key: string, label: string, isShown: boolean, onPress: () => void) => (
      <Button key={key} plain dimColor label={`${isShown ? '▾' : '▸'} ${label}`} onPress={onPress} />
    )

    return (
      <Box flexDirection="column">
        {header}
        {fresh.length === 0 ? empty : null}
        {section(L.questions, asked)}
        {section(L.tasks, todo)}
        {older.length > 0 ? (
          <Box flexDirection="column" marginTop={1}>
            {fold('older', L.older(older.length), isOlderShown, () => void update($, showOlder, shown => !shown))}
            {isOlderShown ? older.map(q => (q.id === current ? card(q) : row(q, true))) : null}
          </Box>
        ) : null}
        {done.length > 0 ? (
          <Box flexDirection="column" marginTop={older.length > 0 ? 0 : 1}>
            {fold('done', L.done(done.length), isDoneShown, () => void update($, showDone, shown => !shown))}
            {isDoneShown ? done.slice(0, 30).map(closed) : null}
          </Box>
        ) : null}
        {open.length > 1 ? (
          <Box flexDirection="row" columnGap={2} marginTop={1}>
            <Button key="next" plain dimColor hotkey="j" label={L.next} onPress={() => void step($, 1)} />
            <Button key="previous" plain dimColor hotkey="k" label={L.previous} onPress={() => void step($, -1)} />
          </Box>
        ) : null}
      </Box>
    )
  })
}
