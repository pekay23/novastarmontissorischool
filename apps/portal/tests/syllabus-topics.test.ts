import { describe, it, expect } from 'bun:test'
import {
  addTopic,
  canMoveTopic,
  moveTopic,
  normaliseTopics,
  removeTopic,
  updateTopic,
} from '../app/(portal)/syllabus/topic-list'

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
 */

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
    // A row saved before topics were required can come back with an empty
    // list. The editor must still offer somewhere to type.
    const loaded: readonly string[] = []
    const opened = loaded.length > 0 ? loaded : addTopic(loaded)
    expect(opened).toEqual([''])
    expect(normaliseTopics(updateTopic(opened, 0, 'Number bonds'))).toEqual(['Number bonds'])
  })
})