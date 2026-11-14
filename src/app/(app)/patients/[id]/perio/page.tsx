"use client";

import { useCallback, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import clsx from "clsx";
import { useAuth } from "@/lib/auth-context";
import { todayIn } from "@/lib/dates";
import {
  listPatientPerioExams,
  createPerioExam,
  getPerioExam,
  updatePerioExamNotes,
  completePerioExam,
  uncompletePerioExam,
  listEligiblePerioProviders,
  comparePerioExam,
} from "@/lib/perio-api";
import { PerioGrid } from "@/components/perio/perio-grid";
import { PerioOverlay } from "@/components/perio/perio-overlay";
import { PerioReviewPanel } from "@/components/perio/perio-review";
import { renderTooth } from "@/components/perio/tooth-display";

// Duplicated from src/server/lib/permissions.ts's `perio` row, not imported — client code
// never reaches into @/server/lib (same boundary src/components/chart/tooth-shapes.ts and
// the Notes page's NOTE_WRITE_ROLES keep). NOT the same set as clinical_notes — assistants
// get write access here (they transcribe called-out readings), confirmed with the partner
// clinic per docs/specs/pilot-foundations.md §2.
const PERIO_WRITE_ROLES = new Set(["owner", "provider", "hygienist", "assistant"]);
// Mirrors `perio.approve`: the clinicians who sign clinical notes approve perio exams too
// (docs/specs/perio-approval.md). Assistants enter, they don't approve.
const PERIO_APPROVE_ROLES = new Set(["owner", "provider", "hygienist"]);

function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { dateStyle: "medium" });
}

export default function PatientPerioPage() {
  const params = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [selectedExamId, setSelectedExamId] = useState<string | null>(null);
  const [notesDraft, setNotesDraft] = useState<string | null>(null);
  const [newExamProviderId, setNewExamProviderId] = useState<string | null>(null);
  const [compareEnabled, setCompareEnabled] = useState(false);
  // Explicit baseline override — null means "let the server default to the most recent
  // prior exam" (docs/specs/perio.md's "zero extra clicks for the common case").
  const [compareAgainstId, setCompareAgainstId] = useState<string | null>(null);

  const canWrite = !!user?.role && PERIO_WRITE_ROLES.has(user.role);
  const canApprove = !!user?.role && PERIO_APPROVE_ROLES.has(user.role);
  const [reviewOpen, setReviewOpen] = useState(false);

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

  // Perio-scoped eligible-provider list (Owner/Provider/Hygienist/Assistant) — not
  // schedule-api's listProviders(), which excludes assistants (see perio-api.ts).
  const { data: providersData } = useQuery({ queryKey: ["perio-providers"], queryFn: listEligiblePerioProviders });
  const providers = providersData?.data ?? [];

  const { data: compareData } = useQuery({
    queryKey: ["perio-compare", activeExamId, compareAgainstId],
    queryFn: () => comparePerioExam(activeExamId as string, compareAgainstId ?? undefined),
    enabled: compareEnabled && !!activeExamId,
  });

  function refetchExams() {
    queryClient.invalidateQueries({ queryKey: ["perio-exams", params.id] });
  }
  const refetchDetail = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["perio-exam", activeExamId] });
    // A per-tooth save can change this exam's CAL, which the compare-mode delta badges
    // (keyed ["perio-compare", activeExamId, ...]) already fetched — without this they'd
    // keep showing the pre-save delta until Compare was toggled off and back on.
    queryClient.invalidateQueries({ queryKey: ["perio-compare", activeExamId] });
  }, [queryClient, activeExamId]);

  const createMutation = useMutation({
    mutationFn: (providerId: string | null) => createPerioExam(params.id, { exam_date: todayIn(user?.organization.timezone), provider_id: providerId }),
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

  const refetchTranscript = () => queryClient.invalidateQueries({ queryKey: ["perio-events", activeExamId] });
  const completeMutation = useMutation({
    mutationFn: () => completePerioExam(activeExamId as string),
    onSuccess: () => {
      refetchDetail();
      refetchExams();
      refetchTranscript();
    },
  });

  const uncompleteMutation = useMutation({
    mutationFn: (reason: string) => uncompletePerioExam(activeExamId as string, reason),
    onSuccess: () => {
      refetchDetail();
      refetchExams();
      refetchTranscript();
    },
  });

  return (
    <div className="flex gap-4 p-4">
      {/* Exam history sidebar — also doubles as the comparison-baseline picker
          (docs/specs/perio.md): while Compare is on, clicking a different exam picks it as
          the baseline instead of navigating to it. */}
      <aside className="w-40 shrink-0">
        <h2 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-ink-soft">Exams</h2>
        <ul className="flex flex-col gap-1">
          {exams.map((exam) => {
            const isBaseline = compareEnabled && exam.id === (compareData?.against_exam_id ?? compareAgainstId);
            return (
              <li key={exam.id}>
                <button
                  type="button"
                  disabled={compareEnabled && exam.id === activeExamId}
                  onClick={() => {
                    if (compareEnabled) {
                      setCompareAgainstId(exam.id);
                    } else {
                      setSelectedExamId(exam.id);
                      setCompareAgainstId(null);
                    }
                  }}
                  title={compareEnabled && exam.id !== activeExamId ? "Compare against this exam" : undefined}
                  className={clsx(
                    "w-full rounded-[var(--radius)] px-2 py-1.5 text-left text-[12px] disabled:cursor-default",
                    exam.id === activeExamId ? "bg-steel-lo font-medium text-ink" : "text-ink-soft hover:bg-steel-lo/50",
                    isBaseline && "ring-1 ring-inset ring-steel",
                  )}
                >
                  {formatDate(exam.exam_date)}
                  {!exam.completed_at && <span className="ml-1 text-caution">•</span>}
                  {isBaseline && <span className="ml-1 text-[10px] text-steel">vs</span>}
                </button>
              </li>
            );
          })}
        </ul>
        {exams.length === 0 && <p className="text-[12px] text-ink-soft">No gum measurements recorded. Start an exam.</p>}
        {canWrite && (
          <div className="mt-3 flex flex-col gap-1">
            <label className="text-[10px] font-medium uppercase tracking-wide text-ink-soft" htmlFor="new-exam-provider">
              Performed by
            </label>
            {/* Who actually probed, not necessarily who's at the keyboard — an assistant
                transcribing for a hygienist is the reason this is pickable, not defaulted
                silently to the logged-in user. docs/specs/perio.md. */}
            <select
              id="new-exam-provider"
              value={newExamProviderId ?? user?.id ?? ""}
              onChange={(e) => setNewExamProviderId(e.target.value)}
              className="h-7 w-full rounded-[var(--radius)] border border-rule bg-surface px-1.5 text-[12px] text-ink outline-none focus-visible:border-steel"
            >
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={createMutation.isPending}
              onClick={() => createMutation.mutate(newExamProviderId ?? user?.id ?? null)}
              className="h-7 w-full rounded-[var(--radius)] bg-steel px-2 text-[12px] font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              New exam
            </button>
          </div>
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
                  {examDetail.approved_at ? (
                    <span className="text-healthy">Approved</span>
                  ) : (
                    <span className="text-caution">Draft — not approved</span>
                  )}{" "}
                  · examined by {providers.find((p) => p.id === examDetail.provider_id)?.full_name ?? "—"}
                  {examDetail.approved_at && examDetail.approved_by && (
                    <> · approved by {providers.find((p) => p.id === examDetail.approved_by)?.full_name ?? "—"}</>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setCompareEnabled((v) => !v);
                    setCompareAgainstId(null);
                  }}
                  className={clsx(
                    "h-7 rounded-[var(--radius)] border px-3 text-[12px] font-medium",
                    compareEnabled ? "border-steel bg-steel-lo text-ink" : "border-rule text-ink hover:bg-steel-lo",
                  )}
                >
                  Compare
                </button>
                {canWrite && (
                  <button
                    type="button"
                    onClick={() => setReviewOpen(true)}
                    className={clsx(
                      "h-7 rounded-[var(--radius)] px-3 text-[12px] font-medium",
                      examDetail.completed_at ? "border border-rule text-ink hover:bg-steel-lo" : "bg-steel text-white hover:opacity-90",
                    )}
                  >
                    {examDetail.completed_at ? "Transcript" : "Review and approve"}
                  </button>
                )}
              </div>
            </div>

            <PerioReviewPanel
              open={reviewOpen}
              onClose={() => setReviewOpen(false)}
              examId={examDetail.id}
              approved={!!examDetail.completed_at}
              approvedLine={
                examDetail.approved_at
                  ? `Approved by ${providers.find((p) => p.id === examDetail.approved_by)?.full_name ?? "—"} · ${new Date(examDetail.approved_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: user?.organization.timezone })}`
                  : null
              }
              canApprove={canApprove}
              onApprove={() => completeMutation.mutate()}
              approving={completeMutation.isPending}
              onReopen={(reason) => uncompleteMutation.mutate(reason)}
              reopening={uncompleteMutation.isPending}
              error={((completeMutation.error ?? uncompleteMutation.error) as Error | null)?.message ?? null}
              renderTooth={(t) => renderTooth(t, user?.organization.tooth_notation_display ?? "fdi")}
              timeZone={user?.organization.timezone}
            />

            {compareEnabled && compareData && compareData.against_exam_id === null && (
              <p className="text-[12px] text-ink-soft">No prior exam to compare against — this is the first one on record.</p>
            )}

            <PerioGrid
              examId={examDetail.id}
              teeth={examDetail.teeth}
              probingSequence={user?.organization.probing_sequence ?? null}
              completed={!!examDetail.completed_at}
              toothDisplay={user?.organization.tooth_notation_display ?? "fdi"}
              compareDeltas={compareEnabled ? (compareData?.deltas ?? null) : null}
              onSaved={refetchDetail}
            />

            {/* Read surface, not the entry grid — reflects saved state only, refreshes
                whenever examDetail refetches. docs/specs/perio.md's "Graphical overlay". */}
            <PerioOverlay teeth={examDetail.teeth} toothDisplay={user?.organization.tooth_notation_display ?? "fdi"} />

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
