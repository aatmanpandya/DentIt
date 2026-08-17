import { redirect } from "next/navigation";

// "/" is Today — the nav rail links /schedule directly, but the root of the app shell
// redirects here too so a bare login/deep-link lands on the day view rather than a
// blank shell. See src/app/(app)/schedule/page.tsx for the day view itself.
export default function TodayPage() {
  redirect("/schedule");
}
