import React from 'react';

/**
 * Paper/panel surface with hairline border and large radius.
 *
 * @startingPoint section="Display" subtitle="Paper, panel, raised & inverse cards" viewport="700x260"
 */
export interface CardProps extends React.HTMLAttributes<HTMLElement> {
  /** Surface style. @default "paper" */
  variant?: 'paper' | 'panel' | 'raised' | 'inverse';
  /** Internal padding. @default "md" */
  pad?: 'sm' | 'md' | 'lg';
  /** Add hover/press affordance for clickable cards. @default false */
  interactive?: boolean;
  /** Element/tag to render. @default "div" */
  as?: keyof JSX.IntrinsicElements;
  children?: React.ReactNode;
}

export function Card(props: CardProps): JSX.Element;
