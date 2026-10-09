import Link from "next/link";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";

interface StudioHeaderProps {
  description?: string;
}

export function StudioHeader({ description }: StudioHeaderProps) {
  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur-md sm:px-6 lg:px-8">
      <Link href="/" className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-foreground text-background">
          <span className="text-sm font-bold tracking-tight">璞</span>
        </div>
        <div className="leading-tight">
          <p className="text-sm font-semibold tracking-tight">Render Studio</p>
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Pure Group
          </p>
        </div>
      </Link>

      <p className="hidden min-w-0 flex-1 truncate pl-3 text-xs text-muted-foreground sm:block">
        {description}
      </p>
      <div className="flex-1 sm:hidden" />

      <ThemeToggle />
      <form action="/api/auth/logout" method="POST">
        <Button variant="ghost" size="icon" aria-label="登出" type="submit">
          <LogOut />
        </Button>
      </form>
    </header>
  );
}
