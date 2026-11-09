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

const world = (on: On, found: string = FOUND) => {
  const seen: World = { filled: [], asked: [], sent: [], copied: [] }
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('command.register', () => ({ value: { command: 'loose-ends' } }))
  on('session.id', () => ({ value: 'session-1' }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('model.complete', (_, e) => {
    seen.asked.push(e.prompt)
    return { value: { isAnswered: true, text: found, usage: USAGE } }
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
    expect((await pane.find({ key: 'row:q1' }))?.text).toContain(QUOTE)
    expect(await pane.find({ text: /čaká na teba/ })).toBeDefined()
    expect(await pane.find({ text: /old logs/ })).toBeUndefined()

    await pane.press({ key: 'row:q1' })
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
  await pane.input({ key: 'ans:q1', text: 'áno, zmraz ho' })
  await clock.advance(10)

  expect(seen.sent).toEqual([{ text: `> ${QUOTE}\n\náno, zmraz ho`, asUser: true }])
  expect(seen.filled).toEqual([])
  expect(await pane.find({ key: 'row:q1' })).toBeUndefined()
  expect((await pane.find({ key: 'done' }))?.text).toContain('Vybavené (1)')
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
  expect(await pane.find({ text: /tvoj krok/ })).toBeDefined()
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
    expect(await pane.find({ text: /rozhodnutie/ })).toBeDefined()
    expect(await pane.find({ text: /your step/ })).toBeDefined()
    expect(await pane.find({ text: /Waiting on you/ })).toBeDefined()

    await pane.press({ key: 'row:q1' })
    expect((await pane.find({ key: 'explain:q1' }))?.text).toContain('Vysvetli')
    await pane.press({ key: 'row:q2' })
    expect((await pane.find({ key: 'explain:q2' }))?.text).toContain('Explain')
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
  expect(await pane.find({ text: /v poli na prompt/ })).toBeDefined()
  expect(seen.sent).toEqual([])

  await $.prompt.submit({ text: `${seen.filled[0] ?? ''}áno`, origin: { kind: 'composer' }, wait: false })
  await clock.advance(10)

  expect(await pane.find({ key: 'row:q1' })).toBeUndefined()
  expect((await pane.find({ key: 'done' }))?.text).toContain('Vybavené (1)')
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
