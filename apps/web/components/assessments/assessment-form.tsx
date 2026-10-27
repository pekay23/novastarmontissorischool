"use client";

import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { z } from "zod";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@novastar/shared-ui";

const namedOption = z.object({ id: z.string(), name: z.string() });
const optionsSchema = z.object({
  options: z.object({
    classSubjects: z.array(z.object({ id: z.string(), label: z.string() })),
    terms: z.array(namedOption),
    types: z.array(namedOption),
    permissions: z.object({
      canCreate: z.boolean(),
      canUpdate: z.boolean(),
      canDelete: z.boolean(),
    }),
  }),
});
const assessmentSchema = z.object({
  name: z.string(),
  description: z.string().nullish(),
  maxScore: z.union([z.number(), z.string()]),
  assessmentDate: z.string(),
  dueDate: z.string().nullish(),
  classSubjectId: z.string(),
  termId: z.string(),
  typeId: z.string(),
});
const emptyForm = {
  name: "",
  description: "",
  maxScore: "100",
  assessmentDate: "",
  dueDate: "",
  classSubjectId: "",
  termId: "",
  typeId: "",
};
const fieldClass =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring";

export function AssessmentForm({ assessmentId }: { assessmentId?: string }) {
  const router = useRouter();
  const formId = useId();
  const [form, setForm] = useState(emptyForm);
  const [options, setOptions] = useState<
    z.infer<typeof optionsSchema>["options"] | null
  >(null);
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const optionResponse = await fetch(
          "/portal/api/assessments?options=1",
          { signal: controller.signal },
        );
        if (!optionResponse.ok)
          throw new Error(
            "Assessment options could not be loaded. Check your access and try again.",
          );
        const loaded = optionsSchema.parse(await optionResponse.json()).options;
        setOptions(loaded);
        if (assessmentId) {
          const response = await fetch(
            `/portal/api/assessments/${encodeURIComponent(assessmentId)}`,
            { signal: controller.signal },
          );
          if (!response.ok)
            throw new Error(
              response.status === 404
                ? "Assessment not found."
                : "Assessment could not be loaded.",
            );
          const assessment = assessmentSchema.parse(await response.json());
          setForm({
            name: assessment.name,
            description: assessment.description ?? "",
            maxScore: String(assessment.maxScore),
            assessmentDate: assessment.assessmentDate.slice(0, 10),
            dueDate: assessment.dueDate?.slice(0, 10) ?? "",
            classSubjectId: assessment.classSubjectId,
            termId: assessment.termId,
            typeId: assessment.typeId,
          });
        }
        setReady(true);
      } catch (error) {
        if (!controller.signal.aborted)
          setError(
            error instanceof Error
              ? error.message
              : "The form could not be loaded.",
          );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [assessmentId]);

  const allowed =
    ready &&
    (assessmentId
      ? options?.permissions.canUpdate
      : options?.permissions.canCreate);
  const noLookups =
    !assessmentId &&
    options &&
    (!options.classSubjects.length ||
      !options.terms.length ||
      !options.types.length);
  function update(key: keyof typeof emptyForm, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !allowed) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(
        assessmentId
          ? `/portal/api/assessments/${encodeURIComponent(assessmentId)}`
          : "/portal/api/assessments",
        {
          method: assessmentId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: form.name.trim(),
            description: form.description,
            maxScore: Number(form.maxScore),
            assessmentDate: form.assessmentDate,
            dueDate: form.dueDate || (assessmentId ? null : undefined),
            ...(!assessmentId
              ? {
                  classSubjectId: form.classSubjectId,
                  termId: form.termId,
                  typeId: form.typeId,
                }
              : {}),
          }),
        },
      );
      if (!response.ok) {
        const failure: unknown = await response.json().catch(() => null);
        throw new Error(
          typeof failure === "object" &&
            failure !== null &&
            "error" in failure &&
            typeof failure.error === "string"
            ? failure.error
            : "The assessment was not saved.",
        );
      }
      router.push("/portal/grades");
      router.refresh();
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "The assessment was not saved.",
      );
    } finally {
      setPending(false);
    }
  }

  if (loading) return <p role="status">Loading assessment form…</p>;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {assessmentId ? "Edit assessment" : "Create assessment"}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-5">
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          {options && !allowed ? (
            <p role="alert" className="text-sm text-destructive">
              You do not have permission to {assessmentId ? "edit" : "create"}{" "}
              assessments.
            </p>
          ) : null}
          {noLookups ? (
            <p role="alert" className="text-sm text-destructive">
              A class subject, term and assessment type must be configured
              before creating an assessment.
            </p>
          ) : null}
          <fieldset
            disabled={pending || !allowed || Boolean(noLookups)}
            className="grid gap-4 sm:grid-cols-2"
          >
            <div className="sm:col-span-2">
              <label
                htmlFor={`${formId}-name`}
                className="mb-1 block text-sm font-medium"
              >
                Assessment name
              </label>
              <input
                id={`${formId}-name`}
                className={fieldClass}
                value={form.name}
                onChange={(event) => update("name", event.target.value)}
                required
              />
            </div>
            {!assessmentId ? (
              <>
                <div className="sm:col-span-2">
                  <label
                    htmlFor={`${formId}-subject`}
                    className="mb-1 block text-sm font-medium"
                  >
                    Class and subject
                  </label>
                  <select
                    id={`${formId}-subject`}
                    className={fieldClass}
                    value={form.classSubjectId}
                    onChange={(event) =>
                      update("classSubjectId", event.target.value)
                    }
                    required
                  >
                    <option value="">Select a class subject</option>
                    {options?.classSubjects.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label
                    htmlFor={`${formId}-term`}
                    className="mb-1 block text-sm font-medium"
                  >
                    Term
                  </label>
                  <select
                    id={`${formId}-term`}
                    className={fieldClass}
                    value={form.termId}
                    onChange={(event) => update("termId", event.target.value)}
                    required
                  >
                    <option value="">Select a term</option>
                    {options?.terms.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label
                    htmlFor={`${formId}-type`}
                    className="mb-1 block text-sm font-medium"
                  >
                    Assessment type
                  </label>
                  <select
                    id={`${formId}-type`}
                    className={fieldClass}
                    value={form.typeId}
                    onChange={(event) => update("typeId", event.target.value)}
                    required
                  >
                    <option value="">Select a type</option>
                    {options?.types.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            ) : null}
            <div>
              <label
                htmlFor={`${formId}-score`}
                className="mb-1 block text-sm font-medium"
              >
                Maximum score
              </label>
              <input
                id={`${formId}-score`}
                className={fieldClass}
                type="number"
                min="1"
                step="1"
                value={form.maxScore}
                onChange={(event) => update("maxScore", event.target.value)}
                required
              />
            </div>
            <div>
              <label
                htmlFor={`${formId}-date`}
                className="mb-1 block text-sm font-medium"
              >
                Assessment date
              </label>
              <input
                id={`${formId}-date`}
                className={fieldClass}
                type="date"
                value={form.assessmentDate}
                onChange={(event) =>
                  update("assessmentDate", event.target.value)
                }
                required
              />
            </div>
            <div>
              <label
                htmlFor={`${formId}-due`}
                className="mb-1 block text-sm font-medium"
              >
                Due date, optional
              </label>
              <input
                id={`${formId}-due`}
                className={fieldClass}
                type="date"
                min={form.assessmentDate || undefined}
                value={form.dueDate}
                onChange={(event) => update("dueDate", event.target.value)}
              />
            </div>
            <div className="sm:col-span-2">
              <label
                htmlFor={`${formId}-description`}
                className="mb-1 block text-sm font-medium"
              >
                Description, optional
              </label>
              <textarea
                id={`${formId}-description`}
                className={fieldClass}
                rows={3}
                value={form.description}
                onChange={(event) => update("description", event.target.value)}
              />
            </div>
          </fieldset>
          <div className="flex gap-3">
            <Button
              type="submit"
              disabled={pending || !allowed || Boolean(noLookups)}
            >
              {pending ? "Saving…" : "Save assessment"}
            </Button>
            <Button asChild variant="outline">
              <Link href="/portal/grades">Cancel</Link>
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
