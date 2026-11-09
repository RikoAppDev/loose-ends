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
  keepOptions,
  languageCode,
  parseExtract,
  parseResolve,
} from '../hooks/extract'
import { langOf, uiLang } from '../hooks/i18n'

const REPLY = [
  'Staging server beží na vetve **main**. Preto by ho ďalší merge hneď nasadil.',
  '',
  '**Zmrazím staging na verzii 2.4.0**, kým nedokončíš testy? Odpovedz áno alebo nie.',
  '',
  '1. Mám nasadiť `2.5-rc` aj na tvoj testovací server?',
  '2. Should the API keep the old upload endpoint for a week?',
].join('\n')

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
