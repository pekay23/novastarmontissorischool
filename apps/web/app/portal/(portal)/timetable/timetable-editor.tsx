"use client";

import { useId, useState } from "react";
import { Button } from "@novastar/shared-ui";
import {
  timetableSchema,
  type TimetableDetail,
  type TimetableOptions,
} from "./timetable-model";

type PeriodDraft = {
  key: string;
  classSubjectId: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  room: string;
};
const fieldClass =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring";
const days = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

export function TimetableEditor({
  classId,
  termId,
  timetable,
  subjects,
  onSaved,
  onCancel,
}: {
  classId: string;
  termId: string;
  timetable: TimetableDetail | null;
  subjects: TimetableOptions["classSubjects"];
  onSaved: (timetable: TimetableDetail) => void;
  onCancel: () => void;
}) {
  const formId = useId();
  const [name, setName] = useState(timetable?.name ?? "Weekly timetable");
  const [published, setPublished] = useState(timetable?.isPublished ?? false);
  const [periods, setPeriods] = useState<PeriodDraft[]>(
    () =>
      timetable?.entries.map((entry) => ({
        key: entry.id,
        classSubjectId: entry.classSubjectId,
        dayOfWeek: entry.dayOfWeek,
        startTime: entry.startTime,
        endTime: entry.endTime,
        room: entry.room ?? "",
      })) ?? [],
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function changePeriod(key: string, patch: Partial<Omit<PeriodDraft, "key">>) {
    setPeriods((current) =>
      current.map((period) =>
        period.key === key ? { ...period, ...patch } : period,
      ),
    );
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    if (periods.some((period) => period.endTime <= period.startTime)) {
      setError("Each period must end after it starts.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/portal/api/timetable", {
        method: timetable ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(timetable ? { id: timetable.id } : {}),
          classId,
          termId,
          name: name.trim(),
          isPublished: published,
          entries: periods.map((period) => ({
            classSubjectId: period.classSubjectId,
            dayOfWeek: period.dayOfWeek,
            startTime: period.startTime,
            endTime: period.endTime,
            room: period.room.trim() || null,
          })),
        }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(
          typeof payload === "object" &&
            payload !== null &&
            "error" in payload &&
            typeof payload.error === "string"
            ? payload.error
            : "The timetable was not saved.",
        );
      if (
        typeof payload !== "object" ||
        payload === null ||
        !("data" in payload)
      )
        throw new Error(
          "The saved timetable could not be read. Reload before retrying.",
        );
      onSaved(timetableSchema.parse(payload.data));
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "The timetable was not saved.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5 rounded-md border p-4">
      <h2 className="text-lg font-semibold">
        {timetable ? "Edit timetable" : "Create timetable"}
      </h2>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <fieldset disabled={pending} className="space-y-4">
        <div>
          <label
            htmlFor={`${formId}-name`}
            className="mb-1 block text-sm font-medium"
          >
            Timetable name
          </label>
          <input
            id={`${formId}-name`}
            className={fieldClass}
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={published}
            onChange={(event) => setPublished(event.target.checked)}
          />
          Published
        </label>
        {!subjects.length ? (
          <p role="status" className="text-sm text-muted-foreground">
            Assign subjects to this class before adding periods. You can save an
            empty draft.
          </p>
        ) : null}
        {periods.map((period, index) => (
          <fieldset
            key={period.key}
            className="grid gap-3 rounded-md border p-4 sm:grid-cols-2 lg:grid-cols-3"
          >
            <legend className="px-1 text-sm font-medium">
              Period {index + 1}
            </legend>
            <div>
              <label
                htmlFor={`${formId}-${period.key}-subject`}
                className="mb-1 block text-sm"
              >
                Subject
              </label>
              <select
                id={`${formId}-${period.key}-subject`}
                className={fieldClass}
                value={period.classSubjectId}
                onChange={(event) =>
                  changePeriod(period.key, {
                    classSubjectId: event.target.value,
                  })
                }
                required
              >
                <option value="">Select subject</option>
                {subjects.map((subject) => (
                  <option key={subject.id} value={subject.id}>
                    {subject.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label
                htmlFor={`${formId}-${period.key}-day`}
                className="mb-1 block text-sm"
              >
                Day
              </label>
              <select
                id={`${formId}-${period.key}-day`}
                className={fieldClass}
                value={period.dayOfWeek}
                onChange={(event) =>
                  changePeriod(period.key, {
                    dayOfWeek: Number(event.target.value),
                  })
                }
              >
                {days.map((day, dayIndex) => (
                  <option key={day} value={dayIndex + 1}>
                    {day}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label
                htmlFor={`${formId}-${period.key}-start`}
                className="mb-1 block text-sm"
              >
                Starts
              </label>
              <input
                id={`${formId}-${period.key}-start`}
                className={fieldClass}
                type="time"
                value={period.startTime}
                onChange={(event) =>
                  changePeriod(period.key, { startTime: event.target.value })
                }
                required
              />
            </div>
            <div>
              <label
                htmlFor={`${formId}-${period.key}-end`}
                className="mb-1 block text-sm"
              >
                Ends
              </label>
              <input
                id={`${formId}-${period.key}-end`}
                className={fieldClass}
                type="time"
                min={period.startTime}
                value={period.endTime}
                onChange={(event) =>
                  changePeriod(period.key, { endTime: event.target.value })
                }
                required
              />
            </div>
            <div>
              <label
                htmlFor={`${formId}-${period.key}-room`}
                className="mb-1 block text-sm"
              >
                Room, optional
              </label>
              <input
                id={`${formId}-${period.key}-room`}
                className={fieldClass}
                value={period.room}
                onChange={(event) =>
                  changePeriod(period.key, { room: event.target.value })
                }
              />
            </div>
            <div className="flex items-end">
              <Button
                variant="outline"
                type="button"
                onClick={() =>
                  setPeriods((current) =>
                    current.filter((item) => item.key !== period.key),
                  )
                }
              >
                Remove period {index + 1}
              </Button>
            </div>
          </fieldset>
        ))}
        <Button
          variant="outline"
          type="button"
          disabled={!subjects.length}
          onClick={() =>
            setPeriods((current) => [
              ...current,
              {
                key: crypto.randomUUID(),
                classSubjectId: subjects[0]?.id ?? "",
                dayOfWeek: 1,
                startTime: "08:00",
                endTime: "09:00",
                room: "",
              },
            ])
          }
        >
          Add period
        </Button>
      </fieldset>
      <div className="flex gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save timetable"}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
