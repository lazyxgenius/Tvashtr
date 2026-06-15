import React from 'react';

/** User/agent avatar — image or auto initials, warm neutral fill. */
export interface AvatarProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Full name, used for initials and alt text. */
  name?: string;
  /** Image URL; falls back to initials when absent. */
  src?: string;
  /** Size. @default "md" */
  size?: 'xs' | 'sm' | 'md' | 'lg';
  /** Circle or rounded square. @default "circle" */
  shape?: 'circle' | 'square';
  /** Use coral tint instead of neutral (e.g. for the agent). @default false */
  accent?: boolean;
}

export function Avatar(props: AvatarProps): JSX.Element;
