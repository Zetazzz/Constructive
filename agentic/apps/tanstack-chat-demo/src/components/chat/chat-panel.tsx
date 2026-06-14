import { AlertTriangle } from 'lucide-react';
import { useEffect } from 'react';

import { useChat } from '#/lib/use-chat';
import { useModels } from '#/lib/use-models';
import { useSettings } from '#/lib/use-settings';

import { ChatInput } from './chat-input';
import { MessageList } from './message-list';
import { ModelPicker } from './model-picker';
import { SettingsPopover } from './settings-popover';

export function ChatPanel() {
  const { settings, update, hydrated } = useSettings();
  const { openai, ollama, ollamaError, refresh, loading } = useModels({
    openaiEnabled: settings.openaiKey.length > 0,
    ollamaBaseUrl: settings.ollamaBaseUrl,
  });
  const chat = useChat();

  const selectedValue = `${settings.selectedProvider}:${settings.selectedModelId}`;
  const hasAnyModel = openai.length + ollama.length > 0;

  useEffect(() => {
    if (!hydrated || loading) return;
    const currentExists =
      (settings.selectedProvider === 'openai' &&
        openai.some((m) => m.id === settings.selectedModelId)) ||
      (settings.selectedProvider === 'ollama' &&
        ollama.some((m) => m.id === settings.selectedModelId));
    if (currentExists) return;
    const fallback = openai[0] ?? ollama[0];
    if (fallback) {
      update({ selectedProvider: fallback.provider, selectedModelId: fallback.id });
    }
  }, [
    hydrated,
    loading,
    openai,
    ollama,
    settings.selectedProvider,
    settings.selectedModelId,
    update,
  ]);

  if (!hydrated) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-label-2 text-[15px]">
        Loading…
      </div>
    );
  }

  const canClear = chat.messages.length > 0 && !chat.isStreaming;

  return (
    <div className="relative mx-auto flex h-dvh w-full max-w-[760px] flex-col bg-bg">
      <Header
        openai={openai}
        ollama={ollama}
        selectedValue={selectedValue}
        onModelChange={(provider, id) =>
          update({ selectedProvider: provider, selectedModelId: id })
        }
        pickerDisabled={!hasAnyModel || chat.isStreaming}
        isStreaming={chat.isStreaming}
        settings={settings}
        onSettingsChange={update}
        onRefresh={refresh}
        onClear={chat.clear}
        canClear={canClear}
      />

      {ollamaError && settings.selectedProvider === 'ollama' && (
        <Banner>
          Can't reach Ollama at{' '}
          <code className="rounded-[4px] bg-white/60 px-1 py-[1px] font-mono text-[12px]">
            {settings.ollamaBaseUrl}
          </code>
          . Run{' '}
          <code className="rounded-[4px] bg-white/60 px-1 py-[1px] font-mono text-[12px]">
            ollama serve
          </code>{' '}
          with{' '}
          <code className="rounded-[4px] bg-white/60 px-1 py-[1px] font-mono text-[12px]">
            OLLAMA_ORIGINS=*
          </code>
          .
        </Banner>
      )}

      <div className="ios-scroll flex-1 overflow-y-auto">
        <MessageList
          messages={chat.messages}
          modelId={settings.selectedModelId}
          hasAnyModel={hasAnyModel}
        />
      </div>

      {chat.error && !chat.messages.some((m) => m.error) && (
        <div className="mx-4 mb-2 rounded-[12px] bg-ios-red-soft px-3 py-2 text-[13px] text-ios-red">
          {chat.error}
        </div>
      )}

      <ChatInput
        onSend={(text) =>
          chat.send(text, {
            provider: settings.selectedProvider,
            modelId: settings.selectedModelId,
            systemPrompt: settings.systemPrompt,
            openaiKey: settings.openaiKey,
          })
        }
        onStop={chat.stop}
        isStreaming={chat.isStreaming}
        disabled={!hasAnyModel}
      />
    </div>
  );
}

type HeaderProps = {
  openai: ReturnType<typeof useModels>['openai'];
  ollama: ReturnType<typeof useModels>['ollama'];
  selectedValue: string;
  onModelChange: (provider: 'openai' | 'ollama', modelId: string) => void;
  pickerDisabled: boolean;
  isStreaming: boolean;
  settings: ReturnType<typeof useSettings>['settings'];
  onSettingsChange: ReturnType<typeof useSettings>['update'];
  onRefresh: () => void;
  onClear: () => void;
  canClear: boolean;
};

function Header({
  openai,
  ollama,
  selectedValue,
  onModelChange,
  pickerDisabled,
  isStreaming,
  settings,
  onSettingsChange,
  onRefresh,
  onClear,
  canClear,
}: HeaderProps) {
  return (
    <header className="chrome-blur sticky top-0 z-30 border-b border-hairline">
      <div className="relative flex h-11 items-center px-3">
        <div className="flex-1">
          {canClear && (
            <button
              type="button"
              onClick={onClear}
              className="press -ml-1 rounded-[8px] px-2 py-1 text-[15px] font-normal text-ios-blue hover:bg-fill-4"
            >
              Clear
            </button>
          )}
        </div>
        <div className="absolute left-1/2 -translate-x-1/2">
          <ModelPicker
            openai={openai}
            ollama={ollama}
            value={selectedValue}
            disabled={pickerDisabled}
            onChange={onModelChange}
            isStreaming={isStreaming}
          />
        </div>
        <div className="flex flex-1 justify-end">
          <SettingsPopover settings={settings} onChange={onSettingsChange} onRefresh={onRefresh} />
        </div>
      </div>
    </header>
  );
}

function Banner({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-4 mt-3 flex items-start gap-2 rounded-[12px] bg-ios-orange-soft px-3 py-2.5 text-[13px] leading-snug text-[#8a4800]">
      <AlertTriangle className="mt-[1px] size-3.5 shrink-0" />
      <div>{children}</div>
    </div>
  );
}
