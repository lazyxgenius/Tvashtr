Large, low-contrast text input with a built-in label/helper/error shell. Set `multiline` for a textarea. Use `Field` to wrap custom controls in the same label styling.

```jsx
<Input label="Workspace name" placeholder="e.g. Looms & Letters" helper="Shown across your team." />
<Input label="Email" type="email" error="That address isn’t valid." />
<Input label="Notes" optional multiline rows={5} placeholder="Anything else…" />

<Field label="Custom" helper="Wrap your own control">
  <MySelect/>
</Field>
```

- `error` overrides `helper` and turns the control coral-red. `optional` adds a plain "Optional" marker. `size="sm"` gives a 36px control.
