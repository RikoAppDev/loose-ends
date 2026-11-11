import { describe, expect, test } from 'claude-code/testing'

import {
  RELEASE,
  buildExtractPrompt,
  commandsFor,
  commandsIn,
  compactSent,
  contextFor,
  draftText,
  findVerbatim,
  fitTables,
  hasQuestionMark,
  hasQuote,
  isOlder,
  keepOptions,
  languageCode,
  mergeSame,
  nearFor,
  parseExtract,
  parseResolve,
  quotedPart,
  quotesAsk,
  sortOpen,
  wholeSentences,
} from '../hooks/extract'
import { langOf, uiLang } from '../hooks/i18n'
import type { Question } from '../types'

const REPLY = [
  'Staging server beží na vetve **main**. Preto by ho ďalší merge hneď nasadil.',
  '',
  '**Zmrazím staging na verzii 2.4.0**, kým nedokončíš testy? Odpovedz áno alebo nie.',
  '',
  '1. Mám nasadiť `2.5-rc` aj na tvoj testovací server?',
  '2. Should the API keep the old upload endpoint for a week?',
].join('\n')

const ask = (id: string, quote: string, more: Partial<Question> = {}): Question => ({
  id,
  quote,
  context: '',
  options: [],
  priority: 'decision',
  kind: 'question',
  status: 'open',
  askedAt: 0,
  rowId: 'r',
  thread: [],
  ...more,
})

describe('whole sentences', () => {
  const line =
    '3. **Deploy:** I build the image and you push it. Before the push, staging needs the new keys (cache and queue), and check that the "Maintenance" flag is off for `shop.example` in the admin console.'

  test('half a sentence grows to the sentence it stands in', () => {
    expect(wholeSentences(line, 'and check that the "Maintenance" flag is off for `shop.example` in the admin console.')).toBe(
      'Before the push, staging needs the new keys (cache and queue), and check that the "Maintenance" flag is off for `shop.example` in the admin console.',
    )
    expect(wholeSentences(line, 'Before the push, staging needs the new keys (cache and queue)')).toBe(
      wholeSentences(line, 'and check that the "Maintenance" flag is off for `shop.example` in the admin console.'),
    )
  })

  test('the list number and label in front stay with the first sentence', () => {
    expect(wholeSentences(line, 'I build the image')).toBe('3. **Deploy:** I build the image and you push it.')
  })

  test('a whole sentence, a span not in the text and a full-width mark stay as they are', () => {
    expect(wholeSentences(REPLY, '**Zmrazím staging na verzii 2.4.0**, kým nedokončíš testy?')).toBe(
      '**Zmrazím staging na verzii 2.4.0**, kým nedokončíš testy?',
    )
    expect(wholeSentences(REPLY, 'not in the text')).toBe('not in the text')
    expect(wholeSentences('先に確認します。テストを実行してください。終わったら教えて', 'テストを実行して')).toBe(
      'テストを実行してください。',
    )
  })
})

describe('one item per ask', () => {
  test('an ask matched twice to the same words stays one item', () => {
    const list = [
      ask('q1', '**Ship it** today?'),
      ask('q2', 'ship it today?'),
      ask('q3', 'Ship it today?', { status: 'answered' }),
      ask('q4', 'Something else?'),
    ]
    expect(mergeSame(list).map(q => q.id)).toEqual(['q1', 'q3', 'q4'])
  })

  test('a reply that quotes the question names it, also when it quotes only a part', () => {
    const q = ask('q1', '1. Which branch should the nightly build use? I suggest main.')
    const { quoted, rest } = quotedPart('> 1. Which branch should the nightly build use? I suggest main.\n\nmain')
    expect(rest).toBe('main')
    expect(quotesAsk(quoted, q)).toBe(true)
    expect(quotesAsk('Which branch should the nightly build use?', q)).toBe(true)
    expect(quotesAsk('main', q)).toBe(false)
    expect(quotesAsk('', q)).toBe(false)
  })

  test('open asks sort by priority, then the oldest first, with drafts last', () => {
    const list = [
      ask('q1', 'Later?', { priority: 'optional', askedAt: 1 }),
      ask('q2', 'Pick one?', { priority: 'decision', askedAt: 5 }),
      ask('q3', 'Blocked here?', { priority: 'blocking', askedAt: 9 }),
      ask('q4', 'Pick another?', { priority: 'decision', askedAt: 2 }),
      ask('q5', 'In the box?', { priority: 'blocking', askedAt: 0, status: 'drafted' }),
      ask('q6', 'Done?', { priority: 'blocking', status: 'answered' }),
    ]
    expect(sortOpen(list).map(q => q.id)).toEqual(['q3', 'q4', 'q2', 'q1', 'q5'])
  })

  test('an ask moves to the older ones after three of the person’s messages', () => {
    expect(isOlder(ask('q1', 'A?', { quiet: 2 }))).toBe(false)
    expect(isOlder(ask('q1', 'A?', { quiet: 3 }))).toBe(true)
    expect(isOlder(ask('q1', 'A?', { quiet: 3, status: 'drafted' }))).toBe(false)
    expect(isOlder(ask('q1', 'A?'))).toBe(false)
  })

  test('the lines nearest the ask come from its own paragraph first', () => {
    const own = 'It is a medium-sized change: the cache moves to its own module and the old keys are read once.'
    expect(nearFor(`Some background first.\n\n${own} Shall I do it in the next release?`, 'Shall I do it in the next release?')).toBe(own)
    expect(nearFor('Some background first.\n\nIt is a small change. Shall I do it?', 'Shall I do it?')).toBe(
      'Some background first.\n\nIt is a small change.',
    )
    expect(nearFor('Background paragraph here.\n\nShall I do it?', 'Shall I do it?')).toBe('Background paragraph here.')
  })
})

describe('findVerbatim', () => {
  test('answers the agent’s own words when the model dropped the markdown', () => {
    expect(findVerbatim(REPLY, 'Zmrazím staging na verzii 2.4.0, kým nedokončíš testy?')).toBe(
      '**Zmrazím staging na verzii 2.4.0**, kým nedokončíš testy?',
    )
  })

  test('keeps the number in front and the code span', () => {
    expect(findVerbatim(REPLY, '1. Mám nasadiť 2.5-rc aj na tvoj testovací server?')).toBe(
      '1. Mám nasadiť `2.5-rc` aj na tvoj testovací server?',
    )
  })

  test('matches across bold text before a comma and adds the list number', () => {
    const reply =
      'Rozhodnutia:\n\n1. Má import pri chybnom riadku **zastaviť celý súbor**, alebo **preskočiť riadok a zapísať varovanie**? Odporúčam preskočiť riadok.'
    expect(
      findVerbatim(reply, 'Má import pri chybnom riadku zastaviť celý súbor, alebo preskočiť riadok a zapísať varovanie?'),
    ).toBe('1. Má import pri chybnom riadku **zastaviť celý súbor**, alebo **preskočiť riadok a zapísať varovanie**?')
    expect(keepOptions(reply, ['zastaviť celý súbor', 'preskočiť riadok a zapísať varovanie'])).toEqual([
      '**zastaviť celý súbor**',
      '**preskočiť riadok a zapísať varovanie**',
    ])
  })

  test('refuses a question the agent never wrote', () => {
    expect(findVerbatim(REPLY, 'Should I also delete the old logs?')).toBeNull()
  })

  test('refuses a translation of the question', () => {
    expect(findVerbatim(REPLY, 'Should I freeze staging on version 2.4.0 until you finish the tests?')).toBeNull()
  })

  test('falls back to the agent’s sentence when one word differs', () => {
    expect(findVerbatim(REPLY, 'Should the API keep the old upload endpoints for a week?')).toBe(
      '2. Should the API keep the old upload endpoint for a week?',
    )
  })

  test('finds a question in a script written without spaces', () => {
    const reply = '我已经修好了登录页面。你要我现在部署到生产环境吗？我等你的回复。'
    expect(findVerbatim(reply, '你要我现在部署到生产环境吗？')).toBe('你要我现在部署到生产环境吗？')
    expect(findVerbatim(reply, '你要我现在部署到生产环境吗?')).toBe('你要我现在部署到生产环境吗？')
    expect(findVerbatim(reply, '你要我现在部署到测试环境吗？')).toBeNull()
  })

  test('works the same in other languages', () => {
    const reply = 'Die Migration ist fertig.\n\n**Soll ich sie jetzt auf Produktion ausrollen**, oder erst morgen früh? Ich empfehle morgen früh.'
    expect(findVerbatim(reply, 'Soll ich sie jetzt auf Produktion ausrollen, oder erst morgen früh?')).toBe(
      '**Soll ich sie jetzt auf Produktion ausrollen**, oder erst morgen früh?',
    )
    expect(keepOptions(reply, ['jetzt', 'morgen früh', 'nächste Woche'])).toEqual(['jetzt', 'morgen früh'])
  })
})

describe('when the small model is asked', () => {
  test('a question mark counts in any script, outside code, links and quoted lines', () => {
    expect(hasQuestionMark('Mám to nasadiť?')).toBe(true)
    expect(hasQuestionMark('¿Lo publico ahora?')).toBe(true)
    expect(hasQuestionMark('你要我现在部署吗？')).toBe(true)
    expect(hasQuestionMark('هل أنشر التحديث الآن؟')).toBe(true)
    expect(hasQuestionMark('Θέλεις να το ανεβάσω;')).toBe(true)

    expect(hasQuestionMark('Hotovo; testy prešli a vetva je zlúčená.')).toBe(false)
    expect(hasQuestionMark('Spusti `a?.b` a pozri výsledok.')).toBe(false)
    expect(hasQuestionMark('Otvor https://example.com/page?id=1 a pozri výsledok.')).toBe(false)
    expect(hasQuestionMark('```\nconst x = a ? b : c\n```\nHotovo.')).toBe(false)
    expect(hasQuestionMark('> Prečo to padá?\n\nOpravil som to.')).toBe(false)
  })
})

describe('the panel language', () => {
  test('each item’s labels follow the language Claude wrote it in', () => {
    const out = parseExtract(
      '{"new":[{"quote":"Mám to nasadiť?","lang":"sk"},{"quote":"Ship it?","lang":"en-GB"},{"quote":"Q?","lang":"Slovak!"}]}',
    )
    expect(out?.found.map(f => f.lang)).toEqual(['sk', 'en', undefined])
    expect(langOf('sk', 'en')).toBe('sk')
    expect(langOf('en', 'sk')).toBe('en')
    expect(langOf('de', 'sk')).toBe('en')
    expect(langOf(undefined, 'sk')).toBe('sk')
    expect(languageCode('SK')).toBe('sk')
    expect(languageCode('pt_BR')).toBe('pt')
    expect(languageCode('')).toBeUndefined()
  })

  test('the fallback comes from settings alone', () => {
    expect(uiLang('sk', undefined, 'en_US.UTF-8')).toBe('sk')
    expect(uiLang('en', 'slovak', 'sk_SK.UTF-8')).toBe('en')
    expect(uiLang('auto', 'slovak', 'en_US.UTF-8')).toBe('sk')
    expect(uiLang('auto', 'japanese', 'sk_SK.UTF-8')).toBe('en')
    expect(uiLang('auto', undefined, 'sk_SK.UTF-8')).toBe('sk')
    expect(uiLang('auto', undefined, 'es_ES.UTF-8')).toBe('en')
    expect(uiLang('auto', undefined, undefined)).toBe('en')
  })
})

describe('the rest of extraction', () => {
  test('keeps only options the reply spells out', () => {
    expect(keepOptions(REPLY, ['áno', 'nie', 'nechaj ho na main'])).toEqual(['áno', 'nie'])
  })

  test('the context is what Claude wrote around the question, without the question itself', () => {
    expect(contextFor(REPLY, '**Zmrazím staging na verzii 2.4.0**, kým nedokončíš testy?')).toBe(
      'Staging server beží na vetve **main**. Preto by ho ďalší merge hneď nasadil.\n\nOdpovedz áno alebo nie.',
    )
    const bare = 'Nasadené na staging.\n\nSkús prihlásenie a daj mi vedieť, ako to šlo.'
    expect(contextFor(bare, 'Skús prihlásenie a daj mi vedieť, ako to šlo.')).toBe('Nasadené na staging.')
  })

  test('a task that announces its command keeps the command in its context, ready to copy', () => {
    const reply = [
      'The v1.2.0 release is out.',
      '',
      'Only v1.2.1 is missing, run this command:',
      '',
      '```',
      '! gh release create v1.2.1 --latest',
      '```',
      '',
      'Then the newest release is marked latest.',
    ].join('\n')
    const quote = 'Only v1.2.1 is missing, run this command:'
    expect(contextFor(reply, quote)).toBe('The v1.2.0 release is out.\n\n```\n! gh release create v1.2.1 --latest\n```')
    expect(commandsFor(reply, quote)).toEqual(['! gh release create v1.2.1 --latest'])

    const split = 'Run this:\n\n```\nmake seed\n\nmake test\n```\n\nDone.'
    expect(contextFor(split, 'Run this:')).toBe('```\nmake seed\n\nmake test\n```')
  })

  test('a command belongs to the task before it, not to the next task in the same reply', () => {
    const reply = [
      'The automatic mode stopped me again. Run it yourself:',
      '',
      '```',
      '! gh release create v1.2.1 --latest',
      '```',
      '',
      'Then v1.2.1 is the latest. To let me create releases myself, allow `Bash(gh release create:*)` in your settings.',
    ].join('\n')
    const first = 'Run it yourself:'
    const second = 'To let me create releases myself, allow `Bash(gh release create:*)` in your settings.'
    expect(commandsFor(reply, first)).toEqual(['! gh release create v1.2.1 --latest'])
    expect(commandsFor(reply, second)).toEqual([])
    expect(contextFor(reply, second)).toBe('Then v1.2.1 is the latest.')
  })

  test('the small model sees what was around each open ask, so it can tell a repeat', () => {
    const open = [
      {
        id: 'q1',
        quote: 'Run it yourself:',
        context: '```\n! gh release create v1.2.1 --latest\n```',
        options: [],
        priority: 'blocking' as const,
        kind: 'action' as const,
        status: 'open' as const,
        askedAt: 0,
        rowId: 'r',
        thread: [],
      },
    ]
    expect(buildExtractPrompt(open, 'new text')).toContain('around it: ``` ! gh release create v1.2.1 --latest ```')
  })

  test('a table too wide for the panel becomes a list with the same words; one that fits stays', () => {
    const text = [
      'Releases:',
      '',
      '| Version | Commit | What it brought |',
      '| --- | --- | --- |',
      '| v0.1.0 | `946f72f` | the first version |',
      '| v0.2.0 | `a38a8a6` | tasks and safer sending |',
      '',
      'Shall I tag them?',
    ].join('\n')
    expect(fitTables(text, 30)).toBe(
      [
        'Releases:',
        '',
        '**Version · Commit · What it brought**',
        '',
        '- v0.1.0 · `946f72f` · the first version',
        '- v0.2.0 · `a38a8a6` · tasks and safer sending',
        '',
        'Shall I tag them?',
      ].join('\n'),
    )
    expect(fitTables(text, 80)).toBe(text)
  })

  test('a task offers the commands Claude wrote, and nothing that only looks like code', () => {
    const task = 'Spusti `gh auth login` a potom `/plugin configure demo@demo`. Hodnota `language: sk`, súbor `README.md`.\n\n```bash\n$ make build\n```'
    expect(commandsIn(task)).toEqual(['make build', 'gh auth login', '/plugin configure demo@demo'])
  })

  test('reads JSON wrapped in prose and drops broken entries', () => {
    const out = parseExtract('Here you go:\n{"new":[{"quote":"Q?","options":["a"],"priority":"blocking"},{"quote":""}],"resolved":[{"id":"q2","note":"done"}]}')
    expect(out?.found).toEqual([{ quote: 'Q?', options: ['a'], priority: 'blocking', kind: 'question' }])
    expect(out?.resolved).toEqual([{ id: 'q2', note: 'done' }])
    expect(parseExtract('no json here')).toBeNull()
    expect(parseResolve('{"answered":[{"id":"q1","answer":"áno"}]}')).toEqual([{ id: 'q1', answer: 'áno' }])
  })

  test('an answer sent from the panel reads short in the transcript', () => {
    const sent = draftText('**Zmrazím staging na verzii 2.4.0**, kým nedokončíš testy?\nOdporúčam áno.', 'áno')
    expect(compactSent(sent, 40)).toBe('áno\n↳ Zmrazím staging na verzii 2.4.0, kým ne…')
    expect(compactSent('just a message I typed')).toBeNull()
    expect(compactSent('> a quote someone pasted')).toBeNull()
  })

  test('an answer drafted in the panel is found again in the sent prompt', () => {
    const quote = '**Zmrazím staging na verzii 2.4.0**, kým nedokončíš testy?'
    const sent = draftText(quote, 'áno')
    expect(sent).toBe('> Zmrazím staging na verzii 2.4.0, kým nedokončíš testy?\n\náno')
    expect(hasQuote(sent, quote)).toBe(true)
    expect(hasQuote('úplne iná správa', quote)).toBe(false)
  })

  test('a release is told from ordinary git work', () => {
    expect(RELEASE.test('gh release create v1.2.0 --notes x')).toBe(true)
    expect(RELEASE.test('git tag v1.2.0')).toBe(true)
    expect(RELEASE.test('git tag -l')).toBe(false)
    expect(RELEASE.test('git push origin main')).toBe(false)
  })
})
