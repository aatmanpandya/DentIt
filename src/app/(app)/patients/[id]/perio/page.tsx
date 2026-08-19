"use client";

import { useCallback, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import clsx from "clsx";
import { useAuth } from "@/lib/auth-context";
import {
  listPatientPerioExams,
  createPerioExam,
  getPerioExam,
  updatePerioExamNotes,
  completePerioExam,
  uncompletePerioExam,
} from "@/lib/perio-api";
import { listProviders } from "@/lib/schedule-api";
import { PerioGrid } from "@/components/perio/perio-grid";

// Duplicated from src/server/lib/permissions.ts's `perio` row, not imported — client code
// never reaches into @/server/lib (same boundary src/components/chart/tooth-shapes.ts and
// the Notes page's NOTE_WRITE_ROLES keep). NOT the same set as clinical_notes — assistants
// get write access here (they transcribe called-out readings), confirmed with the partner
// clinic per docs/specs/pilot-foundations.md §2.
const PERIO_WRITE_ROLES = new Set(["owner", "provider", "hygienist", "assistant"]);

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { dateStyle: "medium" });
}

export default function PatientPerioPage() {
  const params = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [selectedExamId, setSelectedExamId] = useState<string | null>(null);
  const [notesDraft, setNotesDraft] = useState<string | null>(null);

  const canWrite = !!user?.role && PERIO_WRITE_ROLES.has(user.role);

  const { data: examsData } = useQuery({
    queryKey: ["perio-exams", params.id],
    queryFn: () => listPatientPerioExams(params.id),
  });
  const exams = useMemo(() => examsData?.data ?? [], [examsData]);
  const activeExamId = selectedExamId ?? exams[0]?.id ?? null;

  const { data: examDetail } = useQuery({
    queryKey: ["perio-exam", activeExamId],
    queryFn: () => getPerioExam(activeExamId as string),
    enabled: !!activeExamId,
  });

  const { data: providersData } = useQuery({ queryKey: ["providers"], queryFn: listProviders });
  const providers = providersData?.data ?? [];

  function refetchExams() {
    queryClient.invalidateQueries({ queryKey: ["perio-exams", params.id] });
  }
  const refetchDetail = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["perio-exam", activeExamId] });
  }, [queryClient, activeExamId]);

  const createMutation = useMutation({
    mutationFn: (providerId: string | null) => createPerioExam(params.id, { exam_date: todayIso(), provider_id: providerId }),
    onSuccess: (exam) => {
      setSelectedExamId(exam.id);
      refetchExams();
    },
  });

  const notesMutation = useMutation({
    mutationFn: (notes: string) => updatePerioExamNotes(activeExamId as string, notes),
    onSuccess: () => {
      setNotesDraft(null);
      refetchDetail();
    },
  });

  const completeMutation = useMutation({
    mutationFn: () => completePerioExam(activeExamId as string),
    onSuccess: () => {
      refetchDetail();
      refetchExams();
    },
  });

  const uncompleteMutation = useMutation({
    mutationFn: () => uncompletePerioExam(activeExamId as string),
    onSuccess: () => {
      refetchDetail();
      refetchExams();
    },
  });

  return (
    <div className="flex gap-4 p-4">
      {/* Exam history sidebar — also doubles as the comparison-baseline picker
          (docs/specs/perio.md) once the comparison view lands. */}
      <aside className="w-40 shrink-0">
        <h2 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-ink-soft">Exams</h2>
        <ul className="flex flex-col gap-1">
          {exams.map((exam) => (
            <li key={exam.id}>
              <button
                type="button"
                onClick={() => setSelectedExamId(exam.id)}
                className={clsx(
                  "w-full rounded-[var(--radius)] px-2 py-1.5 text-left text-[12px]",
                  exam.id === activeExamId ? "bg-steel-lo font-medium text-ink" : "text-ink-soft hover:bg-steel-lo/50",
                )}
              >
                {formatDate(exam.exam_date)}
                {!exam.completed_at && <span className="ml-1 text-caution">•</span>}
              </button>
            </li>
          ))}
        </ul>
        {exams.length === 0 && <p className="text-[12px] text-ink-soft">No gum measurements recorded. Start an exam.</p>}
        {canWrite && (
          <button
            type="button"
            disabled={createMutation.isPending}
            onClick={() => createMutation.mutate(user?.id ?? null)}
            className="mt-3 h-7 w-full rounded-[var(--radius)] bg-steel px-2 text-[12px] font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            New exam
          </button>
        )}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col gap-3">
        {!activeExamId && <p className="text-ink-soft">No gum measurements recorded. Start an exam.</p>}

        {activeExamId && examDetail && (
          <>
            <div className="flex items-center justify-between">
              <div>
                <h1 className="font-condensed text-lg font-medium text-ink">{formatDate(examDetail.exam_date)}</h1>
                <p className="text-[12px] text-ink-soft">
                  {examDetail.completed_at ? "Completed" : "Draft"} · examined by{" "}
                  {providers.find((p) => p.id === examDetail.provider_id)?.full_name ?? "—"}
                </p>
              </div>
              {canWrite && (
                <button
                  type="button"
                  onClick={() => (examDetail.completed_at ? uncompleteMutation.mutate() : completeMutation.mutate())}
                  className="h-7 rounded-[var(--radius)] border border-rule px-3 text-[12px] font-medium text-ink hover:bg-steel-lo"
                >
                  {examDetail.completed_at ? "Reopen exam" : "Complete exam"}
                </button>
              )}
            </div>

            <PerioGrid
              examId={examDetail.id}
              teeth={examDetail.teeth}
              probingSequence={user?.organization.probing_sequence ?? null}
              completed={!!examDetail.completed_at}
              onSaved={refetchDetail}
            />

            {/* Deliberately inline below the periochart, not in the separate Clinical
                Notes tab — docs/specs/perio.md, more accessible for a note taken at the
                point of charting. */}
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-medium uppercase tracking-wide text-ink-soft" htmlFor="exam-notes">
                Exam notes
              </label>
              <textarea
                id="exam-notes"
                disabled={!canWrite}
                rows={2}
                value={notesDraft ?? examDetail.notes ?? ""}
                onChange={(e) => setNotesDraft(e.target.value)}
                className="rounded-[var(--radius)] border border-rule bg-surface px-2.5 py-2 text-[13px] text-ink outline-none focus-visible:border-steel disabled:bg-paper"
              />
              {notesDraft !== null && notesDraft !== (examDetail.notes ?? "") && (
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={notesMutation.isPending}
                    onClick={() => notesMutation.mutate(notesDraft)}
                    className="h-7 rounded-[var(--radius)] bg-steel px-3 text-[12px] font-medium text-white hover:opacity-90"
                  >
                    Save notes
                  </button>
                  <button type="button" onClick={() => setNotesDraft(null)} className="h-7 px-2 text-[12px] text-ink-soft">
                    Cancel
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
