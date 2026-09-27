import Link from "next/link";

// A page for an address that leads nowhere, in the app's own voice, with the way back. Replaces Next's default 404,
// which said nothing about why and inherited a dark text colour on a light page.
export function NotHere({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="mx-auto flex min-h-[60dvh] max-w-md flex-col items-start justify-center gap-3 px-6">
      <h1 className="text-[24px] leading-tight font-semibold tracking-[-0.01em] text-foreground">{title}</h1>
      <p className="text-[15px] leading-relaxed text-muted-foreground">{detail}</p>
      <Link href="/" className="pressable mt-2 rounded-full bg-foreground px-4 py-2 text-[14px] font-medium text-background">
        Ask a question
      </Link>
    </div>
  );
}
