import React from 'react';

/** Small pill for status and metadata. Muted, warm colors; use the accent sparingly. */
export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Color intent. @default "neutral" */
  variant?: 'neutral' | 'accent' | 'info' | 'success' | 'warning' | 'danger' | 'outline';
  /** Show a leading status dot. @default false */
  dot?: boolean;
  children?: React.ReactNode;
}

export function Badge(props: BadgeProps): JSX.Element;
