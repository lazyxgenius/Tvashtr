import React from 'react';

/** On/off toggle. Coral when on. Use for instant settings, not form submission. */
export interface SwitchProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Inline label to the right of the track. */
  label?: React.ReactNode;
}

export function Switch(props: SwitchProps): JSX.Element;
