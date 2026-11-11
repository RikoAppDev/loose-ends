import { expect, mock, test } from 'claude-code/testing'
import type { EngineMount } from 'claude-code/testing'
import type { On, SessionAppendInput } from 'claude-code'

const REPLY = [
  'Staging server beží na vetve **main**. Preto by ho ďalší merge hneď nasadil.',
  '',
  '**Zmrazím staging na verzii 2.4.0**, kým nedokončíš testy? Odpovedz áno alebo nie.',
].join('\n')

const QUOTE = 'Zmrazím staging na verzii 2.4.0, kým nedokončíš testy?'

const FOUND = JSON.stringify({
  new: [
    {
      quote: QUOTE,
      options: ['áno', 'nie', 'nechaj ho na main'],
      priority: 'blocking',
      kind: 'question',
    },
    { quote: 'Should I also delete the old logs?', options: ['Yes'], priority: 'optional', kind: 'question' },
  ],
  resolved: [],
  repeats: [],
})

const USAGE = { input_tokens: 10, output_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }

const PANE = {
  plugin: 'loose-ends',
  component: 'Pane',
  requestId: 'loose-ends',
  props: {
    title: 'Nedoriešené',
    isFocused: true,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const BAND = {
  plugin: 'loose-ends',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: true,
    maxRows: 10,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

const SK = { options: { language: 'sk' } }

const HINT = {
  plugin: 'loose-ends',
  component: 'PromptHint',
  props: { isDraft: false, isWorking: false, hint: '? for shortcuts' },
} as const

/** The hint line under the prompt as the terminal draws it, with what the mod added at its end. */
const hintOf = async (ui: EngineMount): Promise<string | undefined> => {
  const drawn = await ui.mount({ ...HINT, surface: 'terminal' })
  const text = (await drawn.find({ text: /loose-ends/ }))?.text
  await drawn.unmount()
  return text
}

type World = {
  filled: string[]
  asked: string[]
  sent: { text: string; asUser: boolean }[]
  copied: string[]
}

/** The small model's replies: one for every call, or a list taken in turn, its last one kept for any call after. */
const world = (on: On, found: string | string[] = FOUND, stored: Record<string, unknown> = {}) => {
  const seen: World = { filled: [], asked: [], sent: [], copied: [] }
  const replies = Array.isArray(found) ? [...found] : [found]
  const nextReply = () => (replies.length > 1 ? (replies.shift() ?? '') : (replies[0] ?? ''))
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on, stored)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('command.register', () => ({ value: { command: 'loose-ends' } }))
  on('session.id', () => ({ value: 'session-1' }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('model.complete', (_, e) => {
    seen.asked.push(e.prompt)
    return { value: { isAnswered: true, text: nextReply(), usage: USAGE } }
  })
  on('ui.copy', (_, e) => {
    seen.copied.push(e.text)
    return { value: { isCopied: true } }
  })
  on('ui.focus', () => ({}))
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
  on('prompt.fill', (_, e) => {
    seen.filled.push(e.text)
    return { isFilled: true, text: e.text, cursor: e.text.length }
  })
  on('prompt.submit', (_, e) => {
    if (e.origin.kind === 'plugin') seen.sent.push({ text: e.text, asUser: e.origin.asUser === true })
    return { text: e.text }
  })
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  on('ui.render', { component: 'PromptHint' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text dimColor>{`${e.props.hint}${e.props.tail ?? ''}`}</Text>
  })
  on('ui.render', { component: 'UserMessage' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{e.props.text}</Text>
  })
  return { clock, seen }
}

const reply = (text: string): SessionAppendInput => ({
  message: { type: 'assistant', role: 'assistant', content: [{ type: 'text', text }] },
  door: 'response',
  origin: { kind: 'model', model: 'claude-opus-5-5' },
  uuid: 'row-1',
})

test('a question in a reply is pinned word for word, and an invented one is not', SK, async ($, on) => {
  const { clock, seen } = world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(await hintOf($.ui)).toBe('? for shortcuts · /loose-ends ✓')
  await $.session.append(reply(REPLY))
  await clock.advance(9000)
  expect(await hintOf($.ui)).toBe('? for shortcuts · /loose-ends · 1 otázka')

  for (const surface of ['terminal', 'desktop'] as const) {
    const pane = await $.ui.mount({ ...PANE, surface })
    // Folded, an item is one line: its words cut to the pane's width.
    const folded = (await pane.find({ key: 'row:q1' }))?.text ?? ''
    expect(folded).toContain('Zmrazím staging na verzii 2.4.0')
    expect(folded.includes('\n')).toBe(false)
    expect(await pane.find({ text: /old logs/ })).toBeUndefined()

    await pane.press({ key: 'row:q1' })
    expect((await pane.find({ key: 'row:q1' }))?.text).toContain(QUOTE)
    expect(await pane.find({ text: /Staging server beží na vetve main\. .* Odpovedz áno alebo nie\./ })).toBeDefined()
    expect((await pane.find({ key: 'opt:q1:0' }))?.text).toContain('áno')
    expect((await pane.find({ key: 'opt:q1:1' }))?.text).toContain('nie')
    expect(await pane.find({ key: 'opt:q1:2' })).toBeUndefined()
    await pane.press({ key: 'row:q1' })
    expect(await pane.find({ key: 'opt:q1:0' })).toBeUndefined()
    await pane.unmount()
  }

  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await band.find({ text: /Na teba čaká 1 otázka/ }))?.text).toContain('Na teba čaká 1 otázka')
  await band.unmount()
})

test('with nothing open the panel says so, and the hint line still names the mod', async ($, on) => {
  const { seen } = world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(await hintOf($.ui)).toBe('? for shortcuts · /loose-ends ✓')
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await pane.find({ text: /Nothing waits on you/ })).toBeDefined()
  await pane.unmount()
})

test('the side chat answers in the panel and adds nothing to the agent’s conversation', SK, async ($, on) => {
  const { clock } = world(on)
  const session = mock.session(on)
  const asked: string[] = []
  on('model.fork', (_, e) => {
    asked.push(e.prompt)
    return { value: { isAnswered: true, text: 'Na main pribúdajú merge každú hodinu, takže staging ostane na 2.4.0.', usage: USAGE } }
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.session.append(reply(REPLY))
  await clock.advance(9000)

  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await pane.press({ key: 'row:q1' })
  // The side-chat field stays hidden until asked for.
  expect(await pane.find({ key: 'ask:q1' })).toBeUndefined()
  await pane.press({ key: 'side:q1' })
  expect((await pane.find({ key: 'ask:q1' }))?.props.rows).toBe(2)
  await pane.input({ key: 'ask:q1', text: 'Prečo ho zmraziť?' })
  await clock.advance(10)

  expect(asked[0]).toContain(QUOTE)
  expect(asked[0]).toContain('Prečo ho zmraziť?')
  expect(await pane.find({ text: /ostane na 2\.4\.0/ })).toBeDefined()
  expect(await pane.find({ key: 'row:q1' })).toBeDefined()
  expect(session.appended().map(row => row.uuid)).toEqual(['row-1'])

  const sent = await $.prompt.submit({ text: 'pokračuj', origin: { kind: 'composer' }, wait: false })
  expect(sent.context).toBeUndefined()
  await pane.unmount()
})

test('an answer typed in the panel is sent at once as your message, quoting the question', SK, async ($, on) => {
  const { clock, seen } = world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.session.append(reply(REPLY))
  await clock.advance(9000)

  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await pane.press({ key: 'row:q1' })
  // A fixed height, so a long answer neither gets cut to one row nor moves the cursor on a redraw.
  expect((await pane.find({ key: 'ans:q1' }))?.props.rows).toBe(2)
  await pane.input({ key: 'ans:q1', text: 'áno, zmraz ho' })
  await clock.advance(10)

  expect(seen.sent).toEqual([{ text: `> ${QUOTE}\n\náno, zmraz ho`, asUser: true }])
  expect(seen.filled).toEqual([])
  expect(await pane.find({ key: 'row:q1' })).toBeUndefined()
  expect((await pane.find({ key: 'done' }))?.text).toContain('Vybavené · 1')
  expect(await hintOf($.ui)).toBe('? for shortcuts · /loose-ends ✓')
  await pane.unmount()
})

test('a sent answer reads short in the transcript, whole under ctrl+o, and other rows are untouched', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const text = `> ${QUOTE}\n\náno, zmraz ho`
  const row = async (origin: { kind: 'plugin'; name: string } | { kind: 'composer' }, isExpanded: boolean) => {
    const drawn = await $.ui.mount({
      plugin: 'loose-ends',
      component: 'UserMessage',
      surface: 'terminal',
      props: { text, origin, isExpanded },
    })
    const shown = (await drawn.find({ text: /zmraz/ }))?.text
    await drawn.unmount()
    return shown
  }
  expect(await row({ kind: 'plugin', name: 'loose-ends' }, false)).toBe(`áno, zmraz ho\n↳ ${QUOTE}`)
  expect(await row({ kind: 'plugin', name: 'loose-ends' }, true)).toBe(text)
  expect(await row({ kind: 'plugin', name: 'another-plugin' }, false)).toBe(text)
  expect(await row({ kind: 'composer' }, false)).toBe(text)
})

test('a digit only picks one of Claude’s options; Send sends it', SK, async ($, on) => {
  const { clock, seen } = world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.session.append(reply(REPLY))
  await clock.advance(9000)

  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await pane.press({ key: 'row:q1' })
  expect(await pane.find({ key: 'send:q1' })).toBeUndefined()
  await pane.press({ key: 'opt:q1:1' })
  await clock.advance(10)
  expect(seen.sent).toEqual([])
  expect((await pane.find({ key: 'send:q1' }))?.text).toContain('nie')

  await pane.press({ key: 'send:q1' })
  await clock.advance(10)
  expect(seen.sent).toEqual([{ text: `> ${QUOTE}\n\nnie`, asUser: true }])
  await pane.unmount()
})

test('a task gets its own section, a copy button for its command, and Done', SK, async ($, on) => {
  const task = 'Spusti `gh auth login` a daj mi vedieť, keď to bude hotové.'
  const found = JSON.stringify({ new: [{ quote: task, options: [], priority: 'blocking', kind: 'action' }], resolved: [], repeats: [] })
  const { clock, seen } = world(on, found)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.session.append(reply(`Opravené.\n\n${task}`))
  await $.turn.complete({ answer: task, durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' })
  await clock.advance(400)
  expect(await hintOf($.ui)).toBe('? for shortcuts · /loose-ends · 1 úloha')

  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await pane.find({ text: /Úlohy/ })).toBeDefined()
  expect((await pane.find({ key: 'row:q1' }))?.text).toContain('◉')
  await pane.press({ key: 'row:q1' })
  await pane.press({ key: 'copy:q1:0' })
  expect(seen.copied).toEqual(['gh auth login'])

  await pane.press({ key: 'answered:q1' })
  expect(await pane.find({ key: 'row:q1' })).toBeUndefined()
  await pane.press({ key: 'done' })
  expect(await pane.find({ text: /hotovo/ })).toBeDefined()
  expect(seen.sent).toEqual([])
  await pane.unmount()
})

test('in a mixed chat each item’s labels follow the language Claude wrote it in', async ($, on) => {
  const task = 'Please run `npm run seed` and tell me when it is done.'
  const found = JSON.stringify({
    new: [
      { quote: QUOTE, options: [], priority: 'decision', kind: 'question', lang: 'sk' },
      { quote: task, options: [], priority: 'optional', kind: 'action', lang: 'en' },
    ],
    resolved: [],
    repeats: [],
  })
  const { clock, seen } = world(on, found)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.session.append(reply(`${REPLY}\n\n${task}`))
  await clock.advance(9000)
  expect(await hintOf($.ui)).toBe('? for shortcuts · /loose-ends · 1 question, 1 task')

  for (const surface of ['terminal', 'desktop'] as const) {
    const pane = await $.ui.mount({ ...PANE, surface })
    expect(await pane.find({ text: /Waiting on you/ })).toBeDefined()

    await pane.press({ key: 'row:q1' })
    expect((await pane.find({ key: 'side:q1' }))?.text).toContain('Spýtaj sa')
    expect((await pane.find({ key: 'answered:q1' }))?.text).toContain('Zodpovedané')
    await pane.press({ key: 'row:q2' })
    expect((await pane.find({ key: 'side:q2' }))?.text).toContain('Ask')
    expect((await pane.find({ key: 'answered:q2' }))?.text).toContain('Done')
    await pane.press({ key: 'row:q2' })
    await pane.unmount()
  }

  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await band.find({ text: /Na teba čaká 1 otázka a 1 úloha/ })).toBeDefined()
  await band.unmount()
})

test('“In prompt” puts the question in the prompt box, and sending it from there closes it', SK, async ($, on) => {
  const { clock, seen } = world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.session.append(reply(REPLY))
  await clock.advance(9000)

  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await pane.press({ key: 'row:q1' })
  await pane.press({ key: 'prompt:q1' })
  expect(seen.filled).toEqual([`> ${QUOTE}\n\n`])
  expect((await pane.find({ key: 'row:q1' }))?.text).toContain('✎')
  expect(seen.sent).toEqual([])

  await $.prompt.submit({ text: `${seen.filled[0] ?? ''}áno`, origin: { kind: 'composer' }, wait: false })
  await clock.advance(10)

  expect(await pane.find({ key: 'row:q1' })).toBeUndefined()
  expect((await pane.find({ key: 'done' }))?.text).toContain('Vybavené · 1')
  await pane.unmount()
})

const NONE = JSON.stringify({ new: [], resolved: [], repeats: [] })

test('an ask Claude does not ask again moves to the older ones after three of your messages, and time alone never closes it', SK, async ($, on) => {
  const { clock } = world(on, [FOUND, NONE])
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.session.append(reply(REPLY))
  await clock.advance(9000)
  expect(await hintOf($.ui)).toBe('? for shortcuts · /loose-ends · 1 otázka')

  for (const text of ['ešte skontroluj build', 'a čo testy?', 'pokračuj']) {
    await $.prompt.submit({ text, origin: { kind: 'composer' }, wait: false })
    await clock.advance(10)
  }
  expect(await hintOf($.ui)).toBe('? for shortcuts · /loose-ends ✓')

  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await pane.find({ text: /Nič na teba nečaká/ })).toBeDefined()
  expect(await pane.find({ key: 'row:q1' })).toBeUndefined()
  expect((await pane.find({ key: 'older' }))?.text).toContain('Staršie · 1')
  await pane.press({ key: 'older' })
  expect((await pane.find({ key: 'row:q1' }))?.text).toContain('Zmrazím staging')

  // A few days away from the project: still there, still open.
  await clock.advance(3 * 24 * 3_600_000)
  expect((await pane.find({ key: 'older' }))?.text).toContain('Staršie · 1')
  expect((await pane.find({ key: 'row:q1' }))?.text).toContain('Zmrazím staging')
  expect(await pane.find({ key: 'done' })).toBeUndefined()
  await pane.unmount()
})

test('a fresh ask stays on top however long the work pauses', SK, async ($, on) => {
  const { clock } = world(on, [FOUND, NONE])
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.session.append(reply(REPLY))
  await clock.advance(9000)
  await clock.advance(5 * 24 * 3_600_000)
  expect(await hintOf($.ui)).toBe('? for shortcuts · /loose-ends · 1 otázka')
})

test('an ask an earlier build closed for its age opens again, among the older ones', SK, async ($, on) => {
  const saved = {
    id: 'q1',
    quote: QUOTE,
    context: '',
    options: [],
    priority: 'blocking',
    kind: 'question',
    status: 'dropped',
    askedAt: 1_000,
    closedAt: 2_000,
    closedBy: 'age',
    quiet: 3,
    rowId: 'r',
    thread: [],
  }
  world(on, FOUND, { 's:session-1': { savedAt: 2_000, list: [saved] } })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await pane.find({ key: 'done' })).toBeUndefined()
  expect((await pane.find({ key: 'older' }))?.text).toContain('Staršie · 1')
  await pane.unmount()
})

test('Claude asking again brings an older ask back to the top', SK, async ($, on) => {
  const again = JSON.stringify({ new: [], resolved: [], repeats: [{ id: 'q1', quote: QUOTE }] })
  const { clock } = world(on, [FOUND, NONE, NONE, NONE, again])
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.session.append(reply(REPLY))
  await clock.advance(9000)
  for (const text of ['jedna', 'dva', 'tri']) {
    await $.prompt.submit({ text, origin: { kind: 'composer' }, wait: false })
    await clock.advance(10)
  }
  expect(await hintOf($.ui)).toBe('? for shortcuts · /loose-ends ✓')

  await $.session.append(reply(`Ešte raz: ${REPLY}`))
  await clock.advance(9000)
  expect(await hintOf($.ui)).toBe('? for shortcuts · /loose-ends · 1 otázka')
})

test('a reply that quotes the question settles it, even when the model misses it', SK, async ($, on) => {
  const { clock } = world(on, [FOUND, NONE])
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.session.append(reply(REPLY))
  await clock.advance(9000)

  await $.prompt.submit({ text: `> ${QUOTE}\n\nnie, nechaj ho`, origin: { kind: 'composer' }, wait: false })
  await clock.advance(10)
  expect(await hintOf($.ui)).toBe('? for shortcuts · /loose-ends ✓')

  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await pane.press({ key: 'done' })
  expect(await pane.find({ text: /zodpovedané/ })).toBeDefined()
  await pane.unmount()
})

test('two asks matched to the same new words, or half a sentence each, stay one item', SK, async ($, on) => {
  const text = [
    'Hotovo.',
    '',
    'Pred nasadením treba doplniť kľúče do konfigurácie stagingu, a skontroluj, či je vypnutý príznak údržby.',
  ].join('\n')
  const found = JSON.stringify({
    new: [
      { quote: 'Pred nasadením treba doplniť kľúče do konfigurácie stagingu', options: [], priority: 'blocking', kind: 'action' },
      { quote: 'a skontroluj, či je vypnutý príznak údržby.', options: [], priority: 'blocking', kind: 'action' },
    ],
    resolved: [],
    repeats: [],
  })
  const { clock } = world(on, [found, NONE])
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.session.append(reply(text))
  await $.turn.complete({ answer: text, durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' })
  await clock.advance(400)
  expect(await hintOf($.ui)).toBe('? for shortcuts · /loose-ends · 1 úloha')

  const pane = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 140 }, surface: 'terminal' })
  expect((await pane.find({ key: 'row:q1' }))?.text).toContain(
    'Pred nasadením treba doplniť kľúče do konfigurácie stagingu, a skontroluj, či je vypnutý príznak údržby.',
  )
  expect(await pane.find({ key: 'row:q2' })).toBeUndefined()
  await pane.unmount()
})

test('an unfolded item shows three lines of what stood around it, and m shows all of it', SK, async ($, on) => {
  const long = Array.from({ length: 12 }, (_, i) => `Veta číslo ${i + 1} o tom, čo sa zmenilo v buildoch a prečo.`).join(' ')
  const text = `${long}\n\n**Zmrazím staging na verzii 2.4.0**, kým nedokončíš testy?`
  const { clock } = world(on, [FOUND, NONE])
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.session.append(reply(text))
  await clock.advance(9000)

  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await pane.press({ key: 'row:q1' })
  expect(await pane.find({ text: /Veta číslo 1 / })).toBeDefined()
  expect(await pane.find({ text: /Veta číslo 12/ })).toBeUndefined()
  await pane.press({ key: 'more:q1' })
  expect(await pane.find({ text: /Veta číslo 12/ })).toBeDefined()
  expect((await pane.find({ key: 'more:q1' }))?.text).toContain('Menej')
  await pane.unmount()
})

test('a request with no question mark waits for the end of the turn and is read once', async ($, on) => {
  const { clock, seen } = world(on)
  const request = 'Bitte führe `gh auth login` aus und sag mir Bescheid.'
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.session.append(reply(request))
  await clock.advance(9000)
  expect(seen.asked.length).toBe(0)

  await $.turn.complete({ answer: request, durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' })
  await clock.advance(400)
  expect(seen.asked.length).toBe(1)
  expect(seen.asked[0]).toContain('gh auth login')

  await clock.advance(60_000)
  expect(seen.asked.length).toBe(1)
})
