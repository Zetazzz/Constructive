import { SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';

import { Input } from '#/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '#/components/ui/popover';
import { Textarea } from '#/components/ui/textarea';
import type { ChatSettings } from '#/lib/use-settings';

type Props = {
  settings: ChatSettings
  onChange: (patch: Partial<ChatSettings>) => void
  onRefresh: () => void
}

export function SettingsPopover({ settings, onChange, onRefresh }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Settings"
          className="press -mr-1 flex size-8 items-center justify-center rounded-full text-ios-blue hover:bg-fill-4 data-[state=open]:bg-fill-3"
        >
          <SlidersHorizontal className="size-[18px]" strokeWidth={2} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-[360px] rounded-[16px] border-0 bg-bg-elevated p-0 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.25),0_0_0_0.5px_rgba(0,0,0,0.08)]"
      >
        <div className="px-4 pt-4 pb-3">
          <h3 className="text-[17px] font-semibold text-label" style={{ letterSpacing: '-0.43px' }}>
            Settings
          </h3>
          <p className="mt-0.5 text-[13px] leading-[1.35] text-label-2" style={{ letterSpacing: '-0.08px' }}>
            Keys stay in your browser. Requests go straight to the provider.
          </p>
        </div>

        <div className="px-4">
          <div className="overflow-hidden rounded-[12px] bg-bg-2">
            <Field label="OpenAI key">
              <Input
                id="openai-key"
                type="password"
                placeholder="sk-…"
                value={settings.openaiKey}
                onChange={(e) => onChange({ openaiKey: e.target.value })}
                autoComplete="off"
                className="h-auto rounded-none border-0 bg-transparent px-0 py-0 text-right font-mono text-[13.5px] text-label shadow-none placeholder:text-label-3 focus-visible:ring-0 focus-visible:border-0"
              />
            </Field>
            <Divider />
            <Field label="Ollama">
              <Input
                id="ollama-url"
                placeholder="http://localhost:11434"
                value={settings.ollamaBaseUrl}
                onChange={(e) => onChange({ ollamaBaseUrl: e.target.value })}
                className="h-auto rounded-none border-0 bg-transparent px-0 py-0 text-right font-mono text-[13.5px] text-label shadow-none placeholder:text-label-3 focus-visible:ring-0 focus-visible:border-0"
              />
            </Field>
          </div>

          <div className="mt-4 overflow-hidden rounded-[12px] bg-bg-2 p-3">
            <label
              htmlFor="system-prompt"
              className="block text-[13px] font-medium text-label-2"
              style={{ letterSpacing: '-0.08px' }}
            >
              System prompt
            </label>
            <Textarea
              id="system-prompt"
              rows={3}
              value={settings.systemPrompt}
              onChange={(e) => onChange({ systemPrompt: e.target.value })}
              placeholder="Optional instructions for the assistant"
              className="mt-1.5 resize-none rounded-[8px] border-0 bg-bg px-2.5 py-2 text-[14px] leading-[1.4] text-label shadow-none placeholder:text-label-3 focus-visible:ring-0"
              style={{ letterSpacing: '-0.15px' }}
            />
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between border-t border-hairline px-4 py-3">
          <span className="text-[12.5px] text-label-2">Cached in this browser</span>
          <button
            type="button"
            onClick={() => {
              onRefresh();
              setOpen(false);
            }}
            className="press rounded-full bg-ios-blue px-3 py-1 text-[13px] font-semibold text-white hover:bg-ios-blue-press"
          >
            Refresh models
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <div className="text-[15px] text-label" style={{ letterSpacing: '-0.24px' }}>
        {label}
      </div>
      <div className="flex-1">{children}</div>
    </div>
  );
}

function Divider() {
  return <div className="ml-3 h-px bg-hairline" />;
}
