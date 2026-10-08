'use client'

import { useState } from 'react'
import { Alert, AlertDescription, AlertTitle, Button, Textarea } from '@novastar/shared-ui'
import { Lock, History } from 'lucide-react'
import {
  amendmentHistoryQuery,
  AMENDMENT_REASON_MAX_LENGTH,
  isLockedRecord,
  isUsableReason,
  lockColumnsOf,
  lockNotice,
  MISSING_REASON_MESSAGE,
} from './amendment'
import { AmendmentHistory } from './amendment-history'

/**
 * The amendment reason prompt, as it appears inside the config entity form.
 *
 * It lives in `EntityForm` rather than in a parallel dialog because the decision
 * it forces is part of saving: the reason travels in the SAME PATCH body as the
 * field edits, under one reserved key, so the server can put every changed field
 * of that edit into one `RecordAmendment` group with one reason. A separate
 * "add a note afterwards" step could not do that — by the time it ran, the edit
 * had already landed silently, which is the exact failure the lock prevents.
 *
 * Locked means "cannot be edited SILENTLY", NOT "cannot be edited" — the lock
 * migration's own words. So the fields above stay enabled and the submit button
 * stays live. What changes is that a reason is required, and that the requirement
 * is stated before the attempt rather than discovered from a refusal.
 *
 * The reason is lifted to the caller through `onReasonChange` rather than kept
 * here, because the caller owns the PATCH body: `EntityList` composes the write.
 * Holding the value in one place is what keeps "what was typed" and "what was
 * sent" the same thing.
 */
export function AmendmentReasonField({
  recordId,
  entityType,
  recordName,
  initialData,
  readOnly,
  onReasonChange,
}: {
  recordId: string | null
  entityType: string
  recordName: string
  initialData: Record<string, unknown> | null
  readOnly: boolean
  onReasonChange: (reason: string) => void
}) {
  const locked = isLockedRecord(initialData)
  const { finalizedAt, finalizedById } = lockColumnsOf(initialData)
  const [reason, setReason] = useState('')
  const [showHistory, setShowHistory] = useState(false)

  // Not a locked row: nothing to say, and a prompt that appeared on every record
  // would train people to type a reason into a box that does not matter.
  if (!locked) return null

  const settle = (value: string) => {
    setReason(value)
    onReasonChange(value)
  }

  return (
    <>
      <Alert variant="destructive" className="mb-4">
        <div className="flex items-start gap-2">
          <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div>
            <AlertTitle>This record is locked</AlertTitle>
            <AlertDescription>
              <p>{lockNotice(recordName)}</p>
              <p className="mt-2">
                Locked by{' '}
                <code className="text-xs">{finalizedById ?? 'an account that has since been removed'}</code>{' '}
                {finalizedAt ? (
                  <>
                    on{' '}
                    <time dateTime={finalizedAt}>{new Date(finalizedAt).toLocaleString()}</time>
                  </>
                ) : (
                  'on an unrecorded date'
                )}
                .
              </p>
            </AlertDescription>
          </div>
        </div>
      </Alert>

      {readOnly ? (
        <p className="mb-4 text-sm text-muted-foreground">
          A reason is required to change this record, not to view it.
        </p>
      ) : (
        <div className="mb-4 space-y-2">
          <label htmlFor={`amendment-reason-${recordId ?? 'new'}`} className="text-sm font-medium">
            Reason for this change <span className="text-red-500 ml-1">*</span>
          </label>
          <Textarea
            id={`amendment-reason-${recordId ?? 'new'}`}
            value={reason}
            onChange={(event) => settle(event.target.value)}
            placeholder="e.g. Parent reported on 4 Oct that the number on file belonged to the previous owner."
            aria-describedby={`amendment-reason-help-${recordId ?? 'new'}`}
            aria-required="true"
            rows={3}
          />
          <div className="flex items-baseline justify-between gap-3">
            <p id={`amendment-reason-help-${recordId ?? 'new'}`} className="text-sm text-muted-foreground">
              Recorded once against every field you change, so a three-field correction is one
              amendment rather than three.
            </p>
            {/* A live count rather than a `maxLength`. The server trims BEFORE it
                measures, so 1000 characters plus trailing spaces is legal and a hard
                cap would refuse it — and `maxLength` discards what is typed past the
                cap without saying so, which loses the sentence someone just wrote. */}
            <span
              className={`shrink-0 text-xs tabular-nums ${
                reason.trim().length > AMENDMENT_REASON_MAX_LENGTH ? 'text-destructive' : 'text-muted-foreground'
              }`}
            >
              {reason.trim().length}/{AMENDMENT_REASON_MAX_LENGTH}
            </span>
          </div>
          {!isUsableReason(reason) && (
            <p role="alert" className="text-sm text-destructive">
              {/* Two different problems, two different sentences. "Required" would be
                  wrong on a reason that was typed and is too long, and would send the
                  user looking for a box they had already filled in. */}
              {reason.trim().length > AMENDMENT_REASON_MAX_LENGTH
                ? `That reason is ${reason.trim().length} characters. Keep it to ${AMENDMENT_REASON_MAX_LENGTH} or fewer.`
                : MISSING_REASON_MESSAGE}
            </p>
          )}
        </div>
      )}

      {recordId && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mb-4 gap-2"
          onClick={() => setShowHistory(true)}
        >
          <History className="h-4 w-4" />
          Amendment history
        </Button>
      )}

      <AmendmentHistory
        open={showHistory}
        onClose={() => setShowHistory(false)}
        endpoint={amendmentHistoryQuery(entityType, recordId ?? '')}
        entityName={recordName}
      />
    </>
  )
}