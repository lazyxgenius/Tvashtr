Tab switcher in two styles: `line` (coral underline) for page-level sections, `pill` (segmented) for compact in-panel toggles.

```jsx
<Tabs
  variant="line"
  defaultValue="threads"
  items={[
    { value: 'threads', label: 'Threads', count: 12 },
    { value: 'files', label: 'Files' },
    { value: 'settings', label: 'Settings' },
  ]}
  onChange={setTab}
/>

<Tabs variant="pill" items={[{value:'chat',label:'Chat'},{value:'code',label:'Code'}]} />
```

- Controlled (`value`) or uncontrolled (`defaultValue`). Each item takes optional `icon` and `count`.
