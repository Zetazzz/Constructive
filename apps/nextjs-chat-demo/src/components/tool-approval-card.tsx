'use client';

interface ToolApprovalCardProps {
  toolName: string;
  args: Record<string, unknown>;
  onAllow: () => void;
  onDeny: () => void;
}

export function ToolApprovalCard({ toolName, args, onAllow, onDeny }: ToolApprovalCardProps) {
  return (
    <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-700 dark:bg-amber-950">
      <p className="mb-2 text-xs font-medium text-amber-800 dark:text-amber-300">
        Approval required for <span className="font-mono">{toolName}</span>
      </p>
      <pre className="mb-3 overflow-auto whitespace-pre-wrap rounded bg-white p-2 text-[11px] text-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
        {JSON.stringify(args, null, 2)}
      </pre>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onAllow}
          className="rounded-md bg-green-600 px-3 py-1 text-xs font-medium text-white hover:bg-green-700"
        >
          Allow
        </button>
        <button
          type="button"
          onClick={onDeny}
          className="rounded-md bg-zinc-300 px-3 py-1 text-xs font-medium text-zinc-800 hover:bg-zinc-400 dark:bg-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-600"
        >
          Deny
        </button>
      </div>
    </div>
  );
}
