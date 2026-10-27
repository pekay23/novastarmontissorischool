"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  TimetableGrid,
  type TimetablePeriod,
} from "@novastar/shared-ui";
import { TimetableEditor } from "./timetable-editor";
import {
  timetableOptionsSchema,
  timetableSchema,
  type TimetableDetail,
  type TimetableOptions,
} from "./timetable-model";

const fieldClass =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring";

export default function TimetablePage() {
  const searchParams = useSearchParams();
  const [options, setOptions] = useState<TimetableOptions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadOptions = useCallback(async () => {
    setError(null);
    try {
      const response = await fetch("/portal/api/timetable?options=1");
      if (!response.ok)
        throw new Error(
          "Classes and terms could not be loaded. Check your timetable access and try again.",
        );
      setOptions(timetableOptionsSchema.parse(await response.json()).options);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Timetable options could not be loaded.",
      );
    }
  }, []);
  useEffect(() => {
    async function load() { await loadOptions() }
    void load()
  }, [loadOptions]);
  const classId = searchParams.get("class") ?? "";
  const termId = searchParams.get("term") ?? "";

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-3xl font-heading font-bold">Timetable</h1>
        <p className="text-sm text-muted-foreground">
          View and manage weekly class schedules.
        </p>
      </div>
      {error ? (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 text-sm text-destructive"
        >
          <p>{error}</p>
          <Button variant="outline" onClick={() => void loadOptions()}>
            Try again
          </Button>
        </div>
      ) : null}
      {options ? (
        <TimetableSelection
          key={classId + ":" + termId}
          options={options}
          classId={classId}
          termId={termId}
        />
      ) : !error ? (
        <p role="status">Loading classes and terms…</p>
      ) : null}
    </div>
  );
}

function TimetableSelection({
  options,
  classId,
  termId,
}: {
  options: TimetableOptions;
  classId: string;
  termId: string;
}) {
  const router = useRouter();
  const formId = useId();
  const [selectedClass, setSelectedClass] = useState(classId);
  const [selectedTerm, setSelectedTerm] = useState(termId);
  return (
    <>
      <form
        className="grid items-end gap-4 rounded-md border p-4 sm:grid-cols-[1fr_1fr_auto]"
        onSubmit={(event) => {
          event.preventDefault();
          const params = new URLSearchParams({
            class: selectedClass,
            term: selectedTerm,
          });
          router.push("/portal/timetable?" + params.toString());
        }}
      >
        <div>
          <label
            htmlFor={formId + "-class"}
            className="mb-1 block text-sm font-medium"
          >
            Class
          </label>
          <select
            id={formId + "-class"}
            className={fieldClass}
            value={selectedClass}
            onChange={(event) => setSelectedClass(event.target.value)}
            required
          >
            <option value="">Select a class</option>
            {options.classes.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label
            htmlFor={formId + "-term"}
            className="mb-1 block text-sm font-medium"
          >
            Term
          </label>
          <select
            id={formId + "-term"}
            className={fieldClass}
            value={selectedTerm}
            onChange={(event) => setSelectedTerm(event.target.value)}
            required
          >
            <option value="">Select a term</option>
            {options.terms.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" disabled={!selectedClass || !selectedTerm}>
          View timetable
        </Button>
      </form>
      {!options.classes.length || !options.terms.length ? (
        <p className="text-sm text-muted-foreground">
          A class and term must be configured before creating a timetable.
        </p>
      ) : null}
      {classId && termId ? (
        <TimetableView options={options} classId={classId} termId={termId} />
      ) : (
        <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          Select a class and term to view its timetable.
        </p>
      )}
    </>
  );
}

function TimetableView({
  options,
  classId,
  termId,
}: {
  options: TimetableOptions;
  classId: string;
  termId: string;
}) {
  const [timetable, setTimetable] = useState<TimetableDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const params = new URLSearchParams({ classId, termId });
        const response = await fetch(
          "/portal/api/timetable?" + params.toString(),
          { signal: controller.signal },
        );
        if (response.status === 404) {
          setTimetable(null);
          return;
        }
        if (!response.ok)
          throw new Error(
            "The timetable could not be loaded. Check your access and try again.",
          );
        const payload: unknown = await response.json();
        if (
          typeof payload !== "object" ||
          payload === null ||
          !("data" in payload)
        )
          throw new Error("The timetable response could not be read.");
        setTimetable(timetableSchema.parse(payload.data));
        setError(null);
      } catch (error) {
        if (!controller.signal.aborted)
          setError(
            error instanceof Error
              ? error.message
              : "Timetable could not be loaded.",
          );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [classId, termId, reload]);

  if (loading) return <p role="status">Loading timetable…</p>;
  if (error)
    return (
      <div role="alert" className="space-y-3 text-sm text-destructive">
        <p>{error}</p>
        <Button
          variant="outline"
          onClick={() => {
            setLoading(true);
            setError(null);
            setReload((value) => value + 1);
          }}
        >
          Try again
        </Button>
      </div>
    );
  const className =
    options.classes.find((item) => item.id === classId)?.name ?? classId;
  const termName =
    options.terms.find((item) => item.id === termId)?.name ?? termId;
  if (editing)
    return (
      <TimetableEditor
        classId={classId}
        termId={termId}
        timetable={timetable}
        subjects={options.classSubjects.filter(
          (subject) => subject.classId === classId,
        )}
        onSaved={(saved) => {
          setTimetable(saved);
          setEditing(false);
        }}
        onCancel={() => setEditing(false)}
      />
    );
  const periods: TimetablePeriod[] =
    timetable?.entries.map((entry) => ({
      id: entry.id,
      dayOfWeek: entry.dayOfWeek,
      startTime: entry.startTime,
      endTime: entry.endTime,
      room: entry.room,
      subjectName: entry.classSubject?.subject?.name ?? "Unknown subject",
      subjectCode: entry.classSubject?.subject?.code ?? null,
      teacherName: entry.classSubject?.teacher
        ? entry.classSubject.teacher.firstName +
          " " +
          entry.classSubject.teacher.lastName
        : null,
    })) ?? [];
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>
              {className} · {termName}
            </CardTitle>
            {timetable ? (
              <p className="mt-1 text-sm text-muted-foreground">
                {timetable.name} ·{" "}
                {timetable.isPublished ? "Published" : "Draft"}
              </p>
            ) : null}
          </div>
          {options.canUpdate ? (
            <Button onClick={() => setEditing(true)}>
              {timetable ? "Edit timetable" : "Create timetable"}
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent>
        {timetable ? (
          <TimetableGrid
            periods={periods}
            classLabel={className}
            termLabel={termName}
            name={timetable.name}
          />
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No timetable has been created for this class and term.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
