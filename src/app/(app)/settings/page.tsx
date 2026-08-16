import Link from "next/link";
import { ClipboardList, IndianRupee } from "lucide-react";

const ITEMS = [
  {
    href: "/settings/catalog",
    label: "Treatment catalog",
    description: "The procedures this clinic offers — names, categories, and chart scope.",
    icon: ClipboardList,
  },
  {
    href: "/settings/fee-schedule",
    label: "Fee schedule",
    description: "What this clinic charges for each procedure.",
    icon: IndianRupee,
  },
];

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <h1 className="mb-6 font-condensed text-[15px] font-semibold text-ink">Settings</h1>
      <div className="flex flex-col gap-2">
        {ITEMS.map(({ href, label, description, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className="flex items-center gap-3 rounded-[var(--radius)] border border-rule bg-surface px-4 py-3 hover:bg-steel-lo"
          >
            <div className="flex h-9 w-9 flex-none items-center justify-center rounded-[var(--radius)] border border-rule bg-paper text-ink-soft">
              <Icon size={16} strokeWidth={1.75} />
            </div>
            <div>
              <div className="text-[13px] font-medium text-ink">{label}</div>
              <div className="text-[12px] text-ink-soft">{description}</div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
