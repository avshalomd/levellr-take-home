import type { Metadata, Viewport } from "next";
import { Schibsted_Grotesk } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { AppShell } from "@/components/shell/AppShell";
import { ThemeColor } from "@/components/shell/ThemeToggle";
import { Toaster } from "@/components/ui/sonner";
import { APP_NAME, APP_TAGLINE, THEME_COLOR } from "@/lib/app";
import "./globals.css";

const sans = Schibsted_Grotesk({ variable: "--font-schibsted", subsets: ["latin"] });

export const metadata: Metadata = { title: { default: APP_NAME, template: `%s · ${APP_NAME}` }, description: APP_TAGLINE };
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: THEME_COLOR.light },
    { media: "(prefers-color-scheme: dark)", color: THEME_COLOR.dark },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // suppressHydrationWarning: the theme class is set on <html> before the page paints, from the stored choice or
    // the system setting, so the server's HTML cannot know it (next-themes).
    <html lang="en" className={`${sans.variable} h-full antialiased`} suppressHydrationWarning>
      <body className="h-full bg-paper">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <ThemeColor />
          <AppShell>{children}</AppShell>
          {/* Top centre, clear of the composer, and below the phone header rather than over its title. A toast placed at
              the bottom (a chat deleted from the drawer, below 1024px: Sidebar.tsx) sits above the composer. */}
          <Toaster position="top-center" offset={{ top: 16, bottom: 104 }} mobileOffset={{ top: 56, bottom: 104 }} />
        </ThemeProvider>
      </body>
    </html>
  );
}
