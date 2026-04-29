import Link from "next/link";
import { formatCredits } from "@/lib/utils/format";

type TopbarProps = {
  email: string;
  credits: number;
};

export function Topbar({ email, credits }: TopbarProps) {
  return (
    <header className="h-14 border-b border-border bg-surface px-6 flex items-center justify-between">
      <Link href="/dashboard" className="font-semibold tracking-tight">
        Handoff
      </Link>

      <div className="flex items-center gap-6">
        <div className="text-sm text-ink-600 font-mono tabular-nums">
          크레딧 <span className="text-ink-900">{formatCredits(credits)}</span>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-sm text-ink-600 hidden sm:inline">{email}</span>
          <form action="/auth/signout" method="post">
            <button
              type="submit"
              className="text-sm text-ink-600 hover:text-ink-900 transition-colors"
            >
              로그아웃
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
