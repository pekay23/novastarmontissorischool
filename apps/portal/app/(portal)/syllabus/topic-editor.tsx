'use client'

import { Button, Label, Textarea } from '@novastar/shared-ui'
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import {
  addTopic as addTopicTo,
  canMoveTopic,
  moveTopic as moveTopicIn,
  removeTopic as removeTopicFrom,
  updateTopic as updateTopicIn,
} from './topic-list'

/**
 * The syllabus topic editor.
 *
 * One row per topic, in teaching order: a `<Textarea>` for the topic text
 * plus move-up, move-down and remove. There is no rich text editor and no
 * HTML preview, deliberately. The Laravel source used CKEditor 5 and stored
 * one opaque HTML blob, but a syllabus here is consumed as a structured
 * topic list — the API reads `topics String[]` and the portal renders one
 * entry per row — so an opaque blob would have to be parsed back out again
 * to do the one job the product needs. The list is the data.
 *
 * The pure list operations come from `./topic-list` so they are testable
 * without React; this file only wires them to the buttons.
 */
export function TopicEditor({
  topics,
  onChange,
  disabled,
}: {
  topics: readonly string[]
  onChange: (next: readonly string[]) => void
  disabled?: boolean
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor="syllabus-topics">Topics</Label>
      <ul className="space-y-2">
        {topics.map((topic, index) => (
          <li key={index} className="flex items-start gap-2">
            <span
              aria-hidden="true"
              className="mt-2 w-6 shrink-0 text-right text-xs text-muted-foreground tabular-nums"
            >
              {index + 1}
            </span>
            <Textarea
              id={index === 0 ? 'syllabus-topics' : undefined}
              value={topic}
              disabled={disabled}
              rows={2}
              placeholder={`Topic ${index + 1}`}
              aria-label={`Topic ${index + 1}`}
              onChange={(event) => onChange(updateTopicIn(topics, index, event.target.value))}
            />
            <div className="flex shrink-0 gap-1">
              <Button
                type="button"
                variant="outline"
                size="icon"
                disabled={disabled || !canMoveTopic(index, topics.length, -1)}
                onClick={() => onChange(moveTopicIn(topics, index, -1))}
                aria-label={`Move topic ${index + 1} up`}
              >
                <ArrowUp className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                disabled={disabled || !canMoveTopic(index, topics.length, 1)}
                onClick={() => onChange(moveTopicIn(topics, index, 1))}
                aria-label={`Move topic ${index + 1} down`}
              >
                <ArrowDown className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                disabled={disabled || topics.length <= 1}
                onClick={() => onChange(removeTopicFrom(topics, index))}
                aria-label={`Remove topic ${index + 1}`}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="gap-2"
        disabled={disabled}
        onClick={() => onChange(addTopicTo(topics))}
      >
        <Plus className="h-4 w-4" />
        Add topic
      </Button>
    </div>
  )
}