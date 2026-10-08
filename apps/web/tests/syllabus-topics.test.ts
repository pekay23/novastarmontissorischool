import { describe, it, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  addTopic,
  canMoveTopic,
  moveTopic,
  normaliseTopics,
  removeTopic,
  updateTopic,
} from '../app/portal/(portal)/syllabus/topic-list'
import {
  emptySyllabusForm,
  syllabusFormProblem,
  type SyllabusFormState,
} from '../app/portal/(portal)/syllabus/syllabus-form-dialog'
import { TopicEditor } from '../app/portal/(portal)/syllabus/topic-editor'

/**
 * The syllabus topic editor's list operations.
 *
 * The editor is one `<Textarea>` per topic in teaching order, which is the
 * whole reason the CKEditor blob from the Laravel source was not ported: a
 * syllabus here is consumed as a structured list, so the list operations ARE
 * the editor's load-bearing logic. They live in a plain module with no React
 * in it, which is what makes them provable here.
 *
 * Two properties are asserted repeatedly because both are invisible failures
 * in a textarea editor: an out-of-bounds reorder must not corrupt the list,
 * and a no-op must return the same array reference so React does not rebuild
 * the editor and steal focus mid-keystroke.
 *
 * The last block is about the OTHER half of the editor: what the page hands it
 * when a stored syllabus comes back with no topics. That expression lives in a
 * client component with hooks and no test harness, so it is read out of the
 * source and evaluated rather than re-implemented here — see
 * `openedTopicsFor`.
 */

const PAGE = join(import.meta.dir, '..', 'app', '(portal)', 'syllabus', 'page.tsx')

/**
 * The topic list the page's edit handler builds for a stored syllabus.
 *
 * Read out of `page.tsx` and evaluated, NOT restated here. A copy of the
 * expression is a copy of the *intent*; restating it in a test proves only that
 * the copy works, so the production handler could hand the editor an empty list
 * — zero textareas, no visible control, a form that cannot be repaired — and
 * the test would still pass. Evaluating the real expression makes the assertion
 * about what the editor is actually given.
 *
 * If the handler is ever extracted into an exported helper, point this at the
 * helper and delete the source read; the failure mode stays the same either way.
 */
function openedTopicsFor(stored: readonly string[]): readonly string[] {
  const source = readFileSync(PAGE, 'utf-8')
  const handlerStart = source.indexOf('const handleEdit')
  if (handlerStart === -1) throw new Error(`handleEdit not found in ${PAGE}`)
  const handler = source.slice(handlerStart, source.indexOf('const handleDelete', handlerStart))
  const property = /\btopics:\s*(.+?),\r?\n/.exec(handler)
  if (!property) throw new Error(`the topics property of handleEdit's setForm call was not found in ${PAGE}`)

  const evaluate = new Function('syllabus', `return (${property[1]})`) as (
    syllabus: { topics: readonly string[] },
  ) => readonly string[]
  return evaluate({ topics: stored })
}

/** What the user is shown for `topics`: one row per textarea. */
const renderEditor = (topics: readonly string[]) =>
  renderToStaticMarkup(createElement(TopicEditor, { topics, onChange: () => {} }))

/** A complete, submittable form, so only the topics field varies. */
function formWith(topics: readonly string[]): SyllabusFormState {
  return {
    ...emptySyllabusForm([{ id: 'term-1', name: 'Autumn', isCurrent: true, academicYear: { name: '2026' } }]),
    classSubjectId: 'cs-1',
    title: 'Number bonds to 10',
    topics,
  }
}

describe('normaliseTopics', () => {
  it('trims each topic and keeps the order', () => {
    expect(normaliseTopics(['  Number bonds ', 'Patterns', '  Spatial awareness  '])).toEqual([
      'Number bonds',
      'Patterns',
      'Spatial awareness',
    ])
  })

  it('drops empty and whitespace-only rows, which are editing artefacts', () => {
    // A blank row is a legitimate intermediate state while the user has
    // clicked "Add topic" and not typed yet. It cannot be stored.
    expect(normaliseTopics(['', 'Number bonds', '   ', 'Patterns'])).toEqual([
      'Number bonds',
      'Patterns',
    ])
  })

  it('returns an empty list when nothing but blank rows was entered', () => {
    // The API's `z.array(...).min(1)` is what reports this as a 400; this
    // function's job is to hand it the honest list and let it decide.
    expect(normaliseTopics(['', '  '])).toEqual([])
    expect(normaliseTopics([])).toEqual([])
  })
})

describe('canMoveTopic', () => {
  it('allows moving down everywhere except the last row', () => {
    expect(canMoveTopic(0, 3, 1)).toBe(true)
    expect(canMoveTopic(1, 3, 1)).toBe(true)
    expect(canMoveTopic(2, 3, 1)).toBe(false)
  })

  it('allows moving up everywhere except the first row', () => {
    expect(canMoveTopic(0, 3, -1)).toBe(false)
    expect(canMoveTopic(1, 3, -1)).toBe(true)
    expect(canMoveTopic(2, 3, -1)).toBe(true)
  })

  it('denies every move on an empty list', () => {
    expect(canMoveTopic(0, 0, 1)).toBe(false)
    expect(canMoveTopic(0, 0, -1)).toBe(false)
  })
})

describe('moveTopic', () => {
  it('swaps an entry with its neighbour', () => {
    expect(moveTopic(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'c', 'b'])
    expect(moveTopic(['a', 'b', 'c'], 1, -1)).toEqual(['b', 'a', 'c'])
  })

  it('moves the first entry down and the last entry up correctly', () => {
    expect(moveTopic(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c'])
    expect(moveTopic(['a', 'b', 'c'], 2, -1)).toEqual(['a', 'c', 'b'])
  })

  it('returns the same reference for an out-of-bounds move, so no re-render', () => {
    const topics = ['a', 'b', 'c'] as const
    // Rebuilding the array here would remount every textarea and drop focus
    // from whichever one the user is typing in.
    expect(moveTopic(topics, 2, 1)).toBe(topics)
    expect(moveTopic(topics, 0, -1)).toBe(topics)
  })

  it('does not mutate the input', () => {
    const topics = ['a', 'b', 'c']
    moveTopic(topics, 0, 1)
    expect(topics).toEqual(['a', 'b', 'c'])
  })

  it('returns a new reference for a real move, so the editor re-renders', () => {
    const topics = ['a', 'b', 'c'] as const
    expect(moveTopic(topics, 0, 1)).not.toBe(topics)
  })
})

describe('updateTopic', () => {
  it('replaces one entry in place', () => {
    expect(updateTopic(['a', 'b'], 1, 'c')).toEqual(['a', 'c'])
  })

  it('returns the same reference when the value is unchanged', () => {
    const topics = ['a', 'b'] as const
    expect(updateTopic(topics, 0, 'a')).toBe(topics)
  })

  it('does not mutate the input', () => {
    const topics = ['a', 'b']
    updateTopic(topics, 0, 'z')
    expect(topics).toEqual(['a', 'b'])
  })
})

describe('addTopic', () => {
  it('appends one blank row', () => {
    expect(addTopic(['a'])).toEqual(['a', ''])
  })

  it('gives an empty list its first row', () => {
    expect(addTopic([])).toEqual([''])
  })

  it('does not mutate the input', () => {
    const topics = ['a']
    addTopic(topics)
    expect(topics).toEqual(['a'])
  })
})

describe('removeTopic', () => {
  it('removes the entry at the given index', () => {
    expect(removeTopic(['a', 'b', 'c'], 1)).toEqual(['a', 'c'])
  })

  it('collapses to one blank row rather than an unusable empty editor', () => {
    // Zero rows leaves the user with no textarea to type into and no visible
    // control to add one: a form that cannot become valid and cannot be
    // repaired. One blank row is the same state "Add topic" produces.
    expect(removeTopic(['only'], 0)).toEqual([''])
  })

  it('returns the same reference for an out-of-range index', () => {
    const topics = ['a', 'b'] as const
    expect(removeTopic(topics, 5)).toBe(topics)
    expect(removeTopic(topics, -1)).toBe(topics)
  })

  it('does not mutate the input', () => {
    const topics = ['a', 'b']
    removeTopic(topics, 0)
    expect(topics).toEqual(['a', 'b'])
  })
})

describe('editor invariants', () => {
  it('always leaves the editor with at least one row to type into', () => {
    let topics: readonly string[] = ['a', 'b', 'c']
    for (let index = topics.length - 1; index >= 0; index -= 1) {
      topics = removeTopic(topics, index)
      expect(topics.length).toBeGreaterThan(0)
    }
  })

  it('round-trips a reorder back to the original order', () => {
    const original = ['a', 'b', 'c', 'd']
    const down = moveTopic(original, 0, 1)
    const back = moveTopic(down, 1, -1)
    expect(back).toEqual(original)
  })

  it('keeps a stored syllabus valid after a load that left no topics', () => {
    // A row saved before topics were required can come back with an empty list.
    // The editor must still offer somewhere to type — and it is the PAGE's
    // expression that decides, so this runs that expression.
    const opened = openedTopicsFor([])

    expect(opened).toEqual([''])
    expect(normaliseTopics(updateTopic(opened, 0, 'Number bonds'))).toEqual(['Number bonds'])
  })

  it('opens a stored syllabus with exactly one row to type into, not zero', () => {
    // The user-visible consequence, through the real editor component: one
    // textarea. Zero would leave nothing to type into, and the one control that
    // could add a row is what the user would have to find first.
    const html = renderEditor(openedTopicsFor([]))

    expect(html.split('aria-label="Topic ').length - 1).toBe(1)
    expect(html).toContain('Add topic')
  })

  it('does not report a form the user cannot fix as submittable', () => {
    // Why the page cannot hand the editor an empty list and leave it there:
    // with no rows at all there is nothing to judge, so the form reports no
    // problem and the submit button stays live — the guard has to be the page's.
    expect(syllabusFormProblem(formWith([]))).toBeNull()
    // One blank row is what makes the missing topic visible instead.
    expect(syllabusFormProblem(formWith(['']))).toBe('Add at least one topic')
  })

  it('hands a stored list over as a detached copy, so an edit is never a silent write', () => {
    // The stored array belongs to the fetched row; the editor edits rows in
    // place through its own `setState`. Aliasing it would make React skip the
    // re-render for an edit that did change the list.
    const stored = ['Number bonds', 'Making ten']
    const opened = openedTopicsFor(stored)

    expect(opened).toEqual(stored)
    expect(opened).not.toBe(stored)
  })

  it('starts a NEW syllabus with one blank row, the same state an empty load produces', () => {
    expect(emptySyllabusForm([]).topics).toEqual([''])
    expect(openedTopicsFor([])).toEqual(emptySyllabusForm([]).topics)
  })
})