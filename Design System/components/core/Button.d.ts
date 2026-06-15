import React from 'react';

/**
 * Calm, paper-friendly button. One coral accent for primary;
 * everything else is quiet outline/ghost.
 *
 * @startingPoint section="Core" subtitle="Primary, secondary, ghost & tint buttons" viewport="700x240"
 */
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual style. @default "primary" */
  variant?: 'primary' | 'secondary' | 'ghost' | 'tint';
  /** Control height. @default "md" */
  size?: 'sm' | 'md' | 'lg';
  /** Element placed before the label (icon node). */
  iconLeft?: React.ReactNode;
  /** Element placed after the label (icon node). */
  iconRight?: React.ReactNode;
  /** Show a spinner and block interaction. @default false */
  loading?: boolean;
  /** Stretch to fill the container width. @default false */
  fullWidth?: boolean;
  /** Render as an anchor with this href. */
  href?: string;
  children?: React.ReactNode;
}

export function Button(props: ButtonProps): JSX.Element;
