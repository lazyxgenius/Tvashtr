import React from 'react';

/** Square, icon-only button for toolbars and dense controls. */
export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual style. @default "ghost" */
  variant?: 'ghost' | 'outline' | 'solid';
  /** Square size. @default "md" */
  size?: 'sm' | 'md' | 'lg';
  /** Toggle/selected state (coral tint). @default false */
  active?: boolean;
  /** Required for accessibility — describe the action. */
  'aria-label': string;
  children?: React.ReactNode;
}

export function IconButton(props: IconButtonProps): JSX.Element;
