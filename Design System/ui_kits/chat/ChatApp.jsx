// Chat app shell: login → workspace, thread state, fake send/reply.
const REPLIES = [
  "Happily. Here's a calm first draft — plain language, no hype:\n\n“We've quietly reshaped how threads carry context. Pick any one back up and it remembers where you were.”\n\nWant it warmer, or shorter?",
  "Let's take it slowly. The trace points at a nil thread handle being woven before the loom finished spinning up — usually an ordering thing. Move the build call after the ready event and it should settle.",
  "A quiet launch suits this. One note to your list, the mark on the empty state, and a single thread people can reply to. No countdown, no fireworks — just the door left open.",
];

function ChatApp() {
  const seed = [
    { id: 't1', group: 'today', title: 'Release note, warmer tone', preview: 'a calmer way to say it', messages: [
      { role: 'user', name: 'Ada Lovelace', text: 'Can you make this release note warmer and less hype-y?' },
      { role: 'agent', text: REPLIES[0] },
    ] },
    { id: 't2', group: 'today', title: 'Stack trace on weave build', preview: 'nil thread handle…', messages: [] },
    { id: 't3', group: 'week', title: 'Planning a quiet launch', preview: 'no countdown, no fireworks', messages: [] },
    { id: 't4', group: 'week', title: 'Naming the canvas feature', preview: 'loom, weave, thread…', messages: [] },
  ];
  const [signedIn, setSignedIn] = React.useState(false);
  const [threads, setThreads] = React.useState(seed);
  const [activeId, setActiveId] = React.useState('t1');
  const replyIdx = React.useRef(0);
  const active = threads.find((t) => t.id === activeId) || threads[0];

  const send = (text) => {
    setThreads((prev) => prev.map((t) => t.id === activeId
      ? { ...t, messages: [...t.messages, { role: 'user', name: 'Ada Lovelace', text }] }
      : t));
    const reply = REPLIES[replyIdx.current++ % REPLIES.length];
    setTimeout(() => {
      setThreads((prev) => prev.map((t) => t.id === activeId
        ? { ...t, messages: [...t.messages, { role: 'agent', text: reply }] }
        : t));
    }, 650);
  };

  const newThread = () => {
    const id = 'n' + Date.now();
    setThreads((prev) => [{ id, group: 'today', title: 'New thread', preview: 'just started', messages: [] }, ...prev]);
    setActiveId(id);
  };

  if (!signedIn) return <ChatLogin onContinue={() => setSignedIn(true)} />;
  return (
    <div style={{ display: 'flex', height: '100%', width: '100%' }}>
      <ChatSidebar threads={threads} activeId={activeId} onSelect={setActiveId} onNew={newThread} />
      <ChatConversation thread={active} onSend={send} />
    </div>
  );
}
window.ChatApp = ChatApp;
