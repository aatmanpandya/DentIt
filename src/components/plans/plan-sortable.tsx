"use client";

import type { ReactNode } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import clsx from "clsx";

/**
 * Thin useSortable wrappers shared by the phase list and each phase's item list —
 * docs/specs/treatment-planning.md's "drag-to-reorder covers both phases and items
 * within a phase". Each render prop gets a drag handle to spread onto its own handle
 * element; the rest of the row/card markup stays exactly where it already was, so
 * these don't reshape the builder's layout, just add drag behavior to it.
 */

function DragHandle({ attributes, listeners, disabled, size }: { attributes: object; listeners: object | undefined; disabled: boolean; size: number }) {
  if (disabled) return <span className="inline-block" style={{ width: size }} />;
  return (
    <button
      type="button"
      {...attributes}
      {...listeners}
      className="cursor-grab touch-none text-ink-soft hover:text-ink active:cursor-grabbing"
      aria-label="Drag to reorder"
    >
      <GripVertical size={size} />
    </button>
  );
}

export function SortablePhase({
  id,
  disabled,
  className,
  children,
}: {
  id: string;
  disabled: boolean;
  className?: string;
  children: (handle: ReactNode) => ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div ref={setNodeRef} style={style} className={clsx(className, isDragging && "opacity-50")}>
      {children(<DragHandle attributes={attributes} listeners={listeners} disabled={disabled} size={12} />)}
    </div>
  );
}

export function SortableItemRow({
  id,
  disabled,
  className,
  children,
}: {
  id: string;
  disabled: boolean;
  className?: string;
  children: (handle: ReactNode) => ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <li ref={setNodeRef} style={style} className={clsx(className, isDragging && "opacity-50")}>
      {children(<DragHandle attributes={attributes} listeners={listeners} disabled={disabled} size={11} />)}
    </li>
  );
}
