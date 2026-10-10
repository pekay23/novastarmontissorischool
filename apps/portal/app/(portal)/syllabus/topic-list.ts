/**
 * Pure list operations for the syllabus topic editor.
 *
 * The editor is a list of plain strings — one `<Textarea>` per topic, in
 * teaching order. Everything that decides *what the list becomes* when the
 * user types, deletes or reorders a row lives here rather than inside the
 * component, so it is provable without a DOM. The component file imports
 * these; the tests import these and never touch React.
 */

/**
 * Trim each topic and drop the ones left empty.
 *
 * An empty row is a legitimate intermediate state while typing — the user
 * clicks "Add topic", gets a blank box, and has not typed yet — so blank
 * rows cannot be rejected at the keystroke. They are dropped at the moment
 * the list is submitted instead, which is also what the API's
 * `z.array(z.string().trim().min(1)).min(1)` enforces. Whitespace-only
 * entries go the same way as empty ones: they are not topics, and storing
 * them would render as an invisible row.
 */
export function normaliseTopics(topics: readonly string[]): string[] {
  return topics.map((topic) => topic.trim()).filter((topic) => topic.length > 0)
}

/**
 * Whether a topic at `index` can move one step in `direction`.
 *
 * Drives the disabled state of the reorder buttons, and — more importantly
 * — is the boundary check `moveTopic` relies on, so the two can never
 * disagree about what is a legal move.
 */
export function canMoveTopic(index: number, length: number, direction: -1 | 1): boolean {
  const target = index + direction
  return target >= 0 && target < length
}

/**
 * Return `topics` with the entry at `index` moved one step in `direction`.
 *
 * Returns the SAME array reference when the move is out of bounds. Callers
 * use the reference to decide whether to `setState` at all: returning a new
 * array for a no-op move would re-render the whole editor and drop focus
 * from whichever textarea the user is typing in, because the keys and
 * component identities would be rebuilt for an edit that changed nothing.
 */
export function moveTopic(
  topics: readonly string[],
  index: number,
  direction: -1 | 1,
): readonly string[] {
  if (!canMoveTopic(index, topics.length, direction)) return topics

  const next = [...topics]
  const target = index + direction
  const held = next[index]
  next[index] = next[target]
  next[target] = held
  return next
}

/**
 * Return `topics` with the entry at `index` replaced by `value`.
 *
 * Same aliasing rule as `moveTopic`: the identical string returns the
 * original array so a keystroke that changes nothing is not a re-render.
 */
export function updateTopic(
  topics: readonly string[],
  index: number,
  value: string,
): readonly string[] {
  if (topics[index] === value) return topics

  const next = [...topics]
  next[index] = value
  return next
}

/**
 * Append one blank row.
 *
 * The row starts empty rather than pre-filled: the user clicked "Add
 * topic", and a placeholder text in a real textarea is content the user
 * has to select and delete.
 */
export function addTopic(topics: readonly string[]): readonly string[] {
  return [...topics, '']
}

/**
 * Remove the entry at `index`.
 *
 * An empty list is replaced with a single blank row rather than zero rows.
 * Zero rows leaves the editor with nothing to type into and no visible
 * control to add one — the user is stuck on a form that cannot become
 * valid. The single blank row is the same state `addTopic` produces, so
 * removing the last topic and adding one are indistinguishable, which is
 * what the user meant.
 */
export function removeTopic(topics: readonly string[], index: number): readonly string[] {
  if (index < 0 || index >= topics.length) return topics

  const next = topics.filter((_, i) => i !== index)
  return next.length > 0 ? next : ['']
}