import { useEffect, useRef } from 'preact/hooks';
import type { MessagePrompt } from '../../src/protocol/log';

/** Modal commit message editor used by Squash and Edit Commit Message. */
export function MessageDialog({ prompt, onAnswer }: { prompt: MessagePrompt; onAnswer(value: string | null): void }) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    // Uncontrolled on purpose: re-renders of the log must not reset what is being typed.
    const element = textarea.current!;
    element.value = prompt.initial;
    element.focus();
    element.setSelectionRange(0, 0);
  }, [prompt.id]);

  const confirm = () => onAnswer(textarea.current!.value);
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') onAnswer(null);
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) confirm();
    event.stopPropagation();
  };

  return (
    <div class="overlay" onMouseDown={(event) => event.target === event.currentTarget && onAnswer(null)}>
      <div class="dialog" onKeyDown={onKeyDown}>
        <div class="dialog-title">{prompt.title}</div>
        <textarea ref={textarea} spellcheck={false} />
        <div class="dialog-buttons">
          <span class="hint">⌘/Ctrl+Enter to confirm</span>
          <button class="secondary" onClick={() => onAnswer(null)}>
            Cancel
          </button>
          <button onClick={confirm}>{prompt.confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
