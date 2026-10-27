import { AssessmentForm } from "@/components/assessments/assessment-form";

export const metadata = { title: "Edit assessment" };

export default async function EditAssessmentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <AssessmentForm assessmentId={id} />;
}
