import { ChevronDown } from 'lucide-react';

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select';
import type { ChatModelOption } from '#/lib/kit-client';

type Props = {
  openai: ChatModelOption[]
  ollama: ChatModelOption[]
  value: string
  onChange: (provider: 'openai' | 'ollama', modelId: string) => void
  disabled?: boolean
  isStreaming?: boolean
}

export function ModelPicker({ openai, ollama, value, onChange, disabled, isStreaming }: Props) {
  const hasModels = openai.length + ollama.length > 0;
  return (
    <Select
      value={hasModels ? value : ''}
      disabled={disabled || !hasModels}
      onValueChange={(v) => {
        const [provider, ...idParts] = v.split(':');
        onChange(provider as 'openai' | 'ollama', idParts.join(':'));
      }}
    >
      <SelectTrigger
        className="press h-8 gap-1 rounded-[8px] border-0 bg-transparent px-2 text-[15px] font-semibold text-label shadow-none hover:bg-fill-4 focus-visible:ring-0 disabled:opacity-60 data-[state=open]:bg-fill-3 [&>svg]:hidden"
        style={{ letterSpacing: '-0.32px' }}
      >
        <SelectValue
          placeholder={
            <span className="text-label-2 font-normal">
              {hasModels ? 'Select model' : 'No models'}
            </span>
          }
        />
        {isStreaming ? (
          <span className="ml-1 inline-block size-1.5 rounded-full bg-ios-blue animate-pulse" />
        ) : (
          <ChevronDown className="ml-0.5 size-3.5 text-label-2" strokeWidth={2.25} />
        )}
      </SelectTrigger>
      <SelectContent
        className="min-w-[240px] rounded-[14px] border-0 bg-bg-elevated shadow-[0_10px_40px_-10px_rgba(0,0,0,0.2),0_0_0_0.5px_rgba(0,0,0,0.08)] p-1"
        align="center"
        sideOffset={8}
      >
        {openai.length > 0 && (
          <SelectGroup className="p-0.5">
            <SelectLabel className="px-2.5 pt-1.5 pb-1 text-[11.5px] font-semibold uppercase tracking-[0.4px] text-label-2">
              OpenAI
            </SelectLabel>
            {openai.map((m) => (
              <SelectItem
                key={`openai:${m.id}`}
                value={`openai:${m.id}`}
                className="rounded-[8px] px-2.5 py-1.5 text-[15px] text-label focus:bg-ios-blue focus:text-white [&>span:last-child]:!text-current"
                style={{ letterSpacing: '-0.24px' }}
              >
                {m.name}
              </SelectItem>
            ))}
          </SelectGroup>
        )}
        {openai.length > 0 && ollama.length > 0 && (
          <div className="mx-2 my-1 h-px bg-hairline" />
        )}
        {ollama.length > 0 && (
          <SelectGroup className="p-0.5">
            <SelectLabel className="px-2.5 pt-1.5 pb-1 text-[11.5px] font-semibold uppercase tracking-[0.4px] text-label-2">
              Ollama
            </SelectLabel>
            {ollama.map((m) => (
              <SelectItem
                key={`ollama:${m.id}`}
                value={`ollama:${m.id}`}
                className="rounded-[8px] px-2.5 py-1.5 text-[15px] text-label focus:bg-ios-blue focus:text-white [&>span:last-child]:!text-current"
                style={{ letterSpacing: '-0.24px' }}
              >
                {m.name}
              </SelectItem>
            ))}
          </SelectGroup>
        )}
        {openai.length === 0 && ollama.length === 0 && (
          <div className="px-3 py-2.5 text-[14px] text-label-2">
            No models available. Add one in Settings.
          </div>
        )}
      </SelectContent>
    </Select>
  );
}
