"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import clsx from "clsx";
import { useAuth } from "@/lib/auth-context";
import { listPatientNotes, createNote, updateNote, deleteNote, signNote, amendNote, type ClinicalNote } from "@/lib/notes-api";
import { listProviders } from "@/lib/schedule-api";

const fieldClass =
  "w-full rounded-[var(--radius)] border border-rule bg-surface px-2.5 py-2 text-[13px] text-ink outline-none focus-visible:border-steel";

// Duplicated from src/server/lib/permissions.ts's clinical_notes / clinical_notes.sign rows,
// not imported — client code never reaches into @/server/lib, same boundary tooth-shapes.ts
// keeps for tooth-notation.ts. The server is still the real gate; this only decides what
// the UI offers to click.
const NOTE_WRITE_ROLES = new Set(["owner", "provider", "hygienist"]);
const NOTE_SIGN_ROLES = new Set(["owner", "provider", "hygienist"]);

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export default function PatientNotesPage() {
  const params = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [composing, setComposing] = useState(false);

  const { data } = useQuery({ queryKey: ["patient-notes", params.id], queryFn: () => listPatientNotes(params.id) });
  const { data: providersData } = useQuery({ queryKey: ["providers"], queryFn: listProviders });

  const notes = useMemo(() => data?.data ?? [], [data]);
  const providerById = useMemo(() => new Map((providersData?.data ?? []).map((p) => [p.id, p])), [providersData]);
  const notesById = useMemo(() => new Map(notes.map((n) => [n.id, n])), [notes]);

  function refetch() {
    queryClient.invalidateQueries({ queryKey: ["patient-notes", params.id] });
  }

  const canWrite = !!user?.role && NOTE_WRITE_ROLES.has(user.role);
  const canSign = !!user?.role && NOTE_SIGN_ROLES.has(user.role);

  const createMutation = useMutation({
    mutationFn: (body: string) => createNote(params.id, { body }),
    onSuccess: () => {
      setComposing(false);
      refetch();
    },
  });

  if (!data) return null;

  return (
    <div className="flex flex-col gap-4 p-4">
      {canWrite && (
        <div>
          {composing ? (
            <ComposeBox
              placeholder="Write a clinical note…"
              submitLabel="Save note"
              onCancel={() => setComposing(false)}
              onSubmit={(body) => createMutation.mutate(body)}
              submitting={createMutation.isPending}
            />
          ) : (
            <button
              type="button"
              onClick={() => setComposing(true)}
              className="h-8 rounded-[var(--radius)] bg-steel px-3 text-[12px] font-medium text-white hover:opacity-90"
            >
              New note
            </button>
          )}
        </div>
      )}

      <ul className="flex flex-col gap-3">
        {notes.map((note) => (
          <NoteCard
            key={note.id}
            note={note}
            authorName={providerById.get(note.provider_id)?.full_name ?? "—"}
            signerName={note.signed_by ? providerById.get(note.signed_by)?.full_name ?? "—" : null}
            original={note.amends_note_id ? notesById.get(note.amends_note_id) ?? null : null}
            originalAuthorName={
              note.amends_note_id ? providerById.get(notesById.get(note.amends_note_id)?.provider_id ?? "")?.full_name ?? "—" : null
            }
            canWrite={canWrite}
            canSign={canSign}
            onChanged={refetch}
          />
        ))}
        {notes.length === 0 && <p className="text-[12px] text-ink-soft">No clinical notes yet.</p>}
      </ul>
    </div>
  );
}

function NoteCard({
  note,
  authorName,
  signerName,
  original,
  originalAuthorName,
  canWrite,
  canSign,
  onChanged,
}: {
  note: ClinicalNote;
  authorName: string;
  signerName: string | null;
  original: ClinicalNote | null;
  originalAuthorName: string | null;
  canWrite: boolean;
  canSign: boolean;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [confirmingSign, setConfirmingSign] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [amending, setAmending] = useState(false);

  const updateMutation = useMutation({
    mutationFn: (body: string) => updateNote(note.id, body),
    onSuccess: () => {
      setEditing(false);
      onChanged();
    },
  });

  const signMutation = useMutation({
    mutationFn: () => signNote(note.id),
    onSuccess: () => {
      setConfirmingSign(false);
      onChanged();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteNote(note.id),
    onSuccess: () => {
      setConfirmingDelete(false);
      onChanged();
    },
  });

  const amendMutation = useMutation({
    mutationFn: (body: string) => amendNote(note.id, body),
    onSuccess: () => {
      setAmending(false);
      onChanged();
    },
  });

  const signed = !!note.signed_at;

  return (
    <li className="rounded-[var(--radius)] border border-rule bg-surface p-3">
      <div className="flex flex-wrap items-center gap-2 text-[12px]">
        <span className="font-medium text-ink">{authorName}</span>
        <span className="text-ink-soft">{formatTimestamp(note.created_at)}</span>
        <span
          className={clsx(
            "font-condensed text-[10px] font-semibold uppercase tracking-wide",
            signed ? "text-healthy" : "text-caution",
          )}
        >
          {signed ? "Signed" : "Draft"}
        </span>
        {signed && signerName && (
          <span className="text-ink-soft">
            by {signerName} · {formatTimestamp(note.signed_at!)}
          </span>
        )}
      </div>

      {original && (
        <p className="mt-1 text-[11px] text-ink-soft">
          Addendum to {originalAuthorName}&rsquo;s note from {formatTimestamp(original.created_at)}
        </p>
      )}

      {editing ? (
        <div className="mt-2">
          <ComposeBox
            initialValue={note.body}
            submitLabel="Save"
            onCancel={() => setEditing(false)}
            onSubmit={(body) => updateMutation.mutate(body)}
            submitting={updateMutation.isPending}
          />
        </div>
      ) : (
        <p className="mt-2 whitespace-pre-wrap text-[13px] text-ink">{note.body}</p>
      )}

      {!editing && canWrite && !signed && !confirmingSign && !confirmingDelete && (
        <div className="mt-2 flex items-center gap-3">
          <button type="button" onClick={() => setEditing(true)} className="text-[12px] text-steel hover:underline">
            Edit
          </button>
          {canSign && (
            <button type="button" onClick={() => setConfirmingSign(true)} className="text-[12px] text-steel hover:underline">
              Sign
            </button>
          )}
          <button type="button" onClick={() => setConfirmingDelete(true)} className="text-[12px] text-bleed hover:underline">
            Delete
          </button>
        </div>
      )}

      {!editing && confirmingSign && (
        <div className="mt-2">
          <span className="flex items-center gap-2 text-[12px]">
            <span className="text-ink-soft">Sign this note? It can&apos;t be edited afterward.</span>
            <button
              type="button"
              disabled={signMutation.isPending}
              onClick={() => signMutation.mutate()}
              className="rounded-[var(--radius)] bg-bleed px-2 py-0.5 font-medium text-white disabled:opacity-50"
            >
              {signMutation.isPending ? "Signing…" : "Confirm sign"}
            </button>
            <button type="button" onClick={() => setConfirmingSign(false)} className="text-ink-soft hover:text-ink">
              Cancel
            </button>
          </span>
        </div>
      )}

      {!editing && confirmingDelete && (
        <div className="mt-2">
          <span className="flex items-center gap-2 text-[12px]">
            <span className="text-ink-soft">Delete this draft? This can&apos;t be undone.</span>
            <button
              type="button"
              disabled={deleteMutation.isPending}
              onClick={() => deleteMutation.mutate()}
              className="rounded-[var(--radius)] bg-bleed px-2 py-0.5 font-medium text-white disabled:opacity-50"
            >
              {deleteMutation.isPending ? "Deleting…" : "Confirm delete"}
            </button>
            <button type="button" onClick={() => setConfirmingDelete(false)} className="text-ink-soft hover:text-ink">
              Cancel
            </button>
          </span>
        </div>
      )}

      {!editing && canWrite && signed && (
        <div className="mt-2">
          {amending ? (
            <ComposeBox
              placeholder="Add an amendment…"
              submitLabel="Save amendment"
              onCancel={() => setAmending(false)}
              onSubmit={(body) => amendMutation.mutate(body)}
              submitting={amendMutation.isPending}
            />
          ) : (
            <button type="button" onClick={() => setAmending(true)} className="text-[12px] text-steel hover:underline">
              Add amendment
            </button>
          )}
        </div>
      )}
    </li>
  );
}

function ComposeBox({
  initialValue = "",
  placeholder,
  submitLabel,
  submitting,
  onSubmit,
  onCancel,
}: {
  initialValue?: string;
  placeholder?: string;
  submitLabel: string;
  submitting: boolean;
  onSubmit: (body: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialValue);

  return (
    <div className="flex flex-col gap-2">
      <textarea
        autoFocus
        rows={4}
        className={fieldClass}
        placeholder={placeholder}
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={submitting || !value.trim()}
          onClick={() => onSubmit(value.trim())}
          className="h-8 rounded-[var(--radius)] bg-steel px-3 text-[12px] font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? "Saving…" : submitLabel}
        </button>
        <button type="button" onClick={onCancel} className="text-[12px] text-ink-soft hover:text-ink">
          Cancel
        </button>
      </div>
    </div>
  );
}
