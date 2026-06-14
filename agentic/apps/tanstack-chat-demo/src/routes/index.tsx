import { createFileRoute } from '@tanstack/react-router';

import { ChatPanel } from '#/components/chat/chat-panel';

export const Route = createFileRoute('/')({
  component: ChatRoute,
  ssr: false,
});

function ChatRoute() {
  return <ChatPanel />;
}
