/**
 * The Desktop launch screens' icons, drawn exactly as the design draws them (Lucide geometry,
 * stroke 1.6). Decorative: every one is aria-hidden next to a text label.
 */
import type { ReactNode } from "react";

function Svg({
  size,
  children,
  className,
  strokeWidth = 1.6,
}: {
  size: number;
  children: ReactNode;
  className?: string;
  strokeWidth?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      style={{ flex: "none" }}
    >
      {children}
    </svg>
  );
}

export function GithubIcon({ size = 17 }: { size?: number }) {
  return (
    <Svg size={size}>
      <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
      <path d="M9 18c-4.51 2-5-2-7-2" />
    </Svg>
  );
}

export function KeyIcon({ size = 16 }: { size?: number }) {
  return (
    <Svg size={size}>
      <path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z" />
      <circle cx="16.5" cy="7.5" r=".5" />
    </Svg>
  );
}

export function FolderIcon({ size = 16 }: { size?: number }) {
  return (
    <Svg size={size}>
      <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
    </Svg>
  );
}

export function PowerIcon({ size = 16 }: { size?: number }) {
  return (
    <Svg size={size}>
      <path d="M12 2v10" />
      <path d="M18.4 6.6a9 9 0 1 1-12.77.04" />
    </Svg>
  );
}

export function SpinnerIcon({ size = 26 }: { size?: number }) {
  return (
    <Svg size={size} className="dt-spin">
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </Svg>
  );
}

export function ExternalLinkIcon({ size = 15 }: { size?: number }) {
  return (
    <Svg size={size}>
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </Svg>
  );
}

export function CopyIcon({ size = 15 }: { size?: number }) {
  return (
    <Svg size={size}>
      <rect width="14" height="14" x="8" y="8" rx="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </Svg>
  );
}

export function WarningIcon({ size = 26 }: { size?: number }) {
  return (
    <Svg size={size}>
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </Svg>
  );
}

export function RefreshIcon({ size = 15 }: { size?: number }) {
  return (
    <Svg size={size}>
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M8 16H3v5" />
    </Svg>
  );
}

export function WifiOffIcon({ size = 26 }: { size?: number }) {
  return (
    <Svg size={size}>
      <path d="M12 20h.01" />
      <path d="M8.5 16.429a5 5 0 0 1 7 0" />
      <path d="M5 12.859a10 10 0 0 1 5.17-2.69" />
      <path d="M19 12.859a10 10 0 0 0-2.007-1.523" />
      <path d="M2 8.82a15 15 0 0 1 4.177-2.643" />
      <path d="M22 8.82a15 15 0 0 0-11.288-3.764" />
      <path d="m2 2 20 20" />
    </Svg>
  );
}

export function CheckCircleIcon({ size = 14 }: { size?: number }) {
  return (
    <Svg size={size}>
      <circle cx="12" cy="12" r="10" />
      <path d="m9 12 2 2 4-4" />
    </Svg>
  );
}

export function InfoIcon({ size = 14 }: { size?: number }) {
  return (
    <Svg size={size}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </Svg>
  );
}

/** The setup rail's done-step check (13px, stroke 2.2). */
export function CheckIcon({ size = 13 }: { size?: number }) {
  return (
    <Svg size={size} strokeWidth={2.2}>
      <path d="M20 6 9 17l-5-5" />
    </Svg>
  );
}

export function LockIcon({ size = 14 }: { size?: number }) {
  return (
    <Svg size={size}>
      <rect width="18" height="11" x="3" y="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </Svg>
  );
}

export function ChevronDownIcon({ size = 15, className }: { size?: number; className?: string }) {
  return (
    <Svg size={size} className={className}>
      <path d="m6 9 6 6 6-6" />
    </Svg>
  );
}

// ---- Setup's First team strip (DT-Team): one icon per role, and the arrow between chips ----

export function ZapIcon({ size = 13 }: { size?: number }) {
  return (
    <Svg size={size}>
      <path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z" />
    </Svg>
  );
}
export function ShieldCheckIcon({ size = 13 }: { size?: number }) {
  return (
    <Svg size={size}>
      <path d="M20 13c0 5-3.5 7.4-7.66 8.95a1 1 0 0 1-.67 0C7.5 20.4 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
      <path d="m9 12 2 2 4-4" />
    </Svg>
  );
}
export function TerminalIcon({ size = 13 }: { size?: number }) {
  return (
    <Svg size={size}>
      <path d="m4 17 6-6-6-6" />
      <path d="M12 19h8" />
    </Svg>
  );
}
export function ClipboardCheckIcon({ size = 13 }: { size?: number }) {
  return (
    <Svg size={size}>
      <rect width="8" height="4" x="8" y="2" rx="1" />
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      <path d="m9 14 2 2 4-4" />
    </Svg>
  );
}
export function PackageCheckIcon({ size = 13 }: { size?: number }) {
  return (
    <Svg size={size}>
      <path d="m16 16 2 2 4-4" />
      <path d="M21 10V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l2-1.14" />
      <path d="M3.29 7 12 12l8.71-5" />
      <path d="M12 22V12" />
    </Svg>
  );
}
export function ArrowRightIcon({ size = 14 }: { size?: number }) {
  return (
    <Svg size={size}>
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </Svg>
  );
}

export function PlayIcon({ size = 15 }: { size?: number }) {
  return (
    <Svg size={size}>
      <polygon points="6 3 20 12 6 21 6 3" />
    </Svg>
  );
}

export function BookIcon({ size = 16 }: { size?: number }) {
  return (
    <Svg size={size}>
      <path d="M12 7v14" />
      <path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z" />
    </Svg>
  );
}

export function WrenchIcon({ size = 16 }: { size?: number }) {
  return (
    <Svg size={size}>
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </Svg>
  );
}

export function UsersIcon({ size = 16 }: { size?: number }) {
  return (
    <Svg size={size}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </Svg>
  );
}
