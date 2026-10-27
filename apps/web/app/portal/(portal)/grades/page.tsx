"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { z } from "zod";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
  useToast,
  useConfirm,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@novastar/shared-ui";
import { Search, BookOpen, MoreHorizontal, Edit2, Trash2 } from "lucide-react";

interface Assessment {
  id: string;
  name: string;
  maxScore: string;
  assessmentDate: string;
  type: { name: string } | null;
  classSubject: {
    subject: { name: string } | null;
    class: { name: string } | null;
  } | null;
}
const permissionsSchema = z.object({
  options: z.object({
    permissions: z.object({
      canCreate: z.boolean(),
      canUpdate: z.boolean(),
      canDelete: z.boolean(),
    }),
  }),
});
const PAGE_SIZE = 20;

export default function GradesPage() {
  const { toast } = useToast();
  const confirm = useConfirm();
  const router = useRouter();
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [permissions, setPermissions] = useState({
    canCreate: false,
    canUpdate: false,
    canDelete: false,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const fetchAssessments = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [response, optionResponse] = await Promise.all([
        fetch("/portal/api/assessments"),
        fetch("/portal/api/assessments?options=1"),
      ]);
      if (!response.ok)
        throw new Error(
          "Failed to load assessments. Check your access and try again.",
        );
      const payload: { data: Assessment[] } = await response.json();
      setAssessments(payload.data);
      if (optionResponse.ok)
        setPermissions(
          permissionsSchema.parse(await optionResponse.json()).options
            .permissions,
        );
      else
        setPermissions({
          canCreate: false,
          canUpdate: false,
          canDelete: false,
        });
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Failed to load assessments.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    async function load() { await fetchAssessments() }
    void load()
  }, [fetchAssessments]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return assessments.filter((item) =>
      [
        item.name,
        item.classSubject?.subject?.name,
        item.classSubject?.class?.name,
        item.type?.name,
      ].some((value) => value?.toLowerCase().includes(query)),
    );
  }, [assessments, search]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages);
  const rows = filtered.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );

  async function handleDelete(assessment: Assessment) {
    if (
      !permissions.canDelete ||
      !(await confirm({
        title: "Delete assessment?",
        description:
          'This will permanently delete "' +
          assessment.name +
          '". This cannot be undone.',
        confirmText: "Delete",
        variant: "destructive",
      }))
    )
      return;
    try {
      const response = await fetch(
        "/portal/api/assessments/" + encodeURIComponent(assessment.id),
        { method: "DELETE" },
      );
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        throw new Error(
          typeof body === "object" &&
            body !== null &&
            "error" in body &&
            typeof body.error === "string"
            ? body.error
            : "Assessment could not be deleted.",
        );
      }
      toast.success({ title: "Assessment deleted" });
      void fetchAssessments();
    } catch (error) {
      toast.error({
        title: "Delete failed",
        description:
          error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-heading font-bold">Grades</h1>
          <p className="text-sm text-muted-foreground">
            Manage assessments and score entry
          </p>
        </div>
        {permissions.canCreate ? (
          <Button asChild>
            <Link href="/portal/grades/new">Create assessment</Link>
          </Button>
        ) : null}
      </div>
      <div className="relative">
        <Search
          className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <input
          aria-label="Search assessments"
          placeholder="Search assessments, subjects or classes…"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
          className="w-full rounded-md border py-2 pl-10 pr-4"
        />
      </div>
      {error ? (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 text-sm text-destructive"
        >
          <p>{error}</p>
          <Button variant="outline" onClick={() => void fetchAssessments()}>
            Try again
          </Button>
        </div>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle>Assessments ({filtered.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p role="status">Loading assessments…</p>
          ) : !rows.length ? (
            <div className="py-8 text-center text-muted-foreground">
              <BookOpen
                aria-hidden="true"
                className="mx-auto mb-3 h-12 w-12 opacity-50"
              />
              <p>No assessments found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <caption className="sr-only">
                  Assessment name, subject, class, type, maximum score and
                  assessment date.
                </caption>
                <thead>
                  <tr className="border-b">
                    {[
                      "Assessment",
                      "Subject",
                      "Class",
                      "Type",
                      "Max score",
                      "Date",
                      "Actions",
                    ].map((name) => (
                      <th key={name} scope="col" className="py-2 text-left">
                        {name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((assessment) => (
                    <tr key={assessment.id} className="border-t">
                      <td className="py-2 font-medium">{assessment.name}</td>
                      <td className="py-2 text-sm">
                        {assessment.classSubject?.subject?.name ?? "N/A"}
                      </td>
                      <td className="py-2 text-sm">
                        {assessment.classSubject?.class?.name ?? "N/A"}
                      </td>
                      <td className="py-2 text-sm">
                        {assessment.type?.name ?? "N/A"}
                      </td>
                      <td className="py-2 text-sm">
                        {Number(assessment.maxScore)}
                      </td>
                      <td className="py-2 text-sm">
                        {assessment.assessmentDate
                          ? new Date(
                              assessment.assessmentDate,
                            ).toLocaleDateString()
                          : "—"}
                      </td>
                      <td className="py-2">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={"Actions for " + assessment.name}
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={() =>
                                router.push(
                                  "/portal/grades/" +
                                    encodeURIComponent(assessment.id) +
                                    "/scores",
                                )
                              }
                            >
                              <Edit2 className="mr-2 h-4 w-4" />
                              Enter scores
                            </DropdownMenuItem>
                            {permissions.canUpdate ? (
                              <DropdownMenuItem
                                onClick={() =>
                                  router.push(
                                    "/portal/grades/" +
                                      encodeURIComponent(assessment.id) +
                                      "/edit",
                                  )
                                }
                              >
                                Edit assessment
                              </DropdownMenuItem>
                            ) : null}
                            {permissions.canDelete ? (
                              <DropdownMenuItem
                                onClick={() => void handleDelete(assessment)}
                                className="text-destructive"
                              >
                                <Trash2 className="mr-2 h-4 w-4" />
                                Delete
                              </DropdownMenuItem>
                            ) : null}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!loading && pages > 1 ? (
            <nav
              aria-label="Assessment pages"
              className="mt-4 flex items-center justify-between gap-3"
            >
              <Button
                variant="outline"
                disabled={currentPage === 1}
                onClick={() => setPage(currentPage - 1)}
              >
                Previous
              </Button>
              <span className="text-sm">
                Page {currentPage} of {pages}
              </span>
              <Button
                variant="outline"
                disabled={currentPage === pages}
                onClick={() => setPage(currentPage + 1)}
              >
                Next
              </Button>
            </nav>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
