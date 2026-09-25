import type { ReactNode, SVGProps } from "react";
import { cn } from "../utils/cn";

export type UiIconName =
  | "profile"
  | "ticket"
  | "plus"
  | "settings"
  | "online"
  | "cards"
  | "team"
  | "local"
  | "search"
  | "theme"
  | "rules"
  | "link"
  | "copy"
  | "check"
  | "back"
  | "chevron";

type UiIconProps = SVGProps<SVGSVGElement> & {
  name: UiIconName;
  size?: number;
};

export default function UiIcon({ name, size = 22, className, ...props }: UiIconProps) {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  const paths: Record<UiIconName, ReactNode> = {
    profile: <><circle cx="12" cy="8" r="3.25" /><path d="M5.5 19c.5-4 2.7-6 6.5-6s6 2 6.5 6" /></>,
    ticket: <><path d="M4 6.5h16v3a2.5 2.5 0 0 0 0 5v3H4v-3a2.5 2.5 0 0 0 0-5z" /><path d="M12 8.5v1M12 12v1M12 15.5v.1" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2M6 6l1.4 1.4M16.6 16.6 18 18M18 6l-1.4 1.4M7.4 16.6 6 18" /><circle cx="12" cy="12" r="7.4" /></>,
    online: <><circle cx="6" cy="12" r="2.25" /><circle cx="18" cy="7" r="2.25" /><circle cx="18" cy="17" r="2.25" /><path d="m8 11 7.7-3M8 13l7.7 3" /></>,
    cards: <><rect x="5" y="5" width="10" height="14" rx="2" transform="rotate(-7 10 12)" /><rect x="10" y="4" width="9" height="14" rx="2" transform="rotate(6 14.5 11)" /><path d="m13.2 9 1.3-1.2L16 9l-1.5 1.4z" /></>,
    team: <><circle cx="8" cy="8" r="2.4" /><circle cx="16.5" cy="9" r="2" /><path d="M3.8 18c.35-3.5 1.8-5.2 4.3-5.2s4 1.7 4.3 5.2M13.4 13.5c2.9-.5 5 .9 5.5 4.5" /></>,
    local: <><circle cx="8" cy="8" r="2.4" /><circle cx="16" cy="8" r="2.4" /><path d="M3.5 18c.4-3.7 1.9-5.4 4.5-5.4s4.1 1.7 4.5 5.4M11.5 18c.4-3.7 1.9-5.4 4.5-5.4s4.1 1.7 4.5 5.4" /></>,
    search: <><circle cx="10.5" cy="10.5" r="5.5" /><path d="m15 15 4 4" /></>,
    theme: <><path d="m12 3 2.2 4.8L19 10l-4.8 2.2L12 17l-2.2-4.8L5 10l4.8-2.2z" /><path d="m18.5 15 .8 1.7 1.7.8-1.7.8-.8 1.7-.8-1.7-1.7-.8 1.7-.8z" /></>,
    rules: <><path d="M5 5.5h5.5A2.5 2.5 0 0 1 13 8v11H7a2 2 0 0 1-2-2z" /><path d="M19 5.5h-3.5A2.5 2.5 0 0 0 13 8v11h4a2 2 0 0 0 2-2zM8 9h2M8 12h2M16 9h1" /></>,
    link: <><path d="m9.5 14.5 5-5" /><path d="M7.3 16.7 5.8 18.2a3.5 3.5 0 0 1-5-5l3-3a3.5 3.5 0 0 1 5 0M16.7 7.3l1.5-1.5a3.5 3.5 0 0 1 5 5l-3 3a3.5 3.5 0 0 1-5 0" transform="translate(-.1) scale(.98)" /></>,
    copy: <><rect x="8" y="8" width="11" height="11" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></>,
    check: <><path d="m5 12.5 4.2 4L19 7" /></>,
    back: <><path d="m15 5-7 7 7 7" /></>,
    chevron: <><path d="m9 5 7 7-7 7" /></>,
  };

  return (
    <svg
      {...props}
      {...common}
      className={cn("ui-icon", className)}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      {paths[name]}
    </svg>
  );
}
