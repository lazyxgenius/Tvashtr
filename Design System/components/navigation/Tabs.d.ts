import React from 'react';

interface TabItem {
  value: string;
  label: React.ReactNode;
  icon?: React.ReactNode;
  count?: number;
}

/** Tab switcher — underline ("line") or segmented ("pill"). Controlled or uncontrolled. */
export interface TabsProps {
  /** Tab definitions. */
  items: TabItem[];
  /** Controlled active value. */
  value?: string;
  /** Initial value when uncontrolled. */
  defaultValue?: string;
  /** Fires with the new value on select. */
  onChange?: (value: string) => void;
  /** Visual style. @default "line" */
  variant?: 'line' | 'pill';
  className?: string;
}

export function Tabs(props: TabsProps): JSX.Element;
