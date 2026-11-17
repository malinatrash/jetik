import * as vscode from 'vscode';
import { settings } from './settings';

export interface MessageContext {
  /** Unified diff of the changes being committed. */
  diff: string;
  /** Full messages of recent commits, newest first: examples of the project's style and language. */
  recentMessages: string[];
  /** Current branch; its name often says what the work is about (feature/…, fix/…, an issue key). */
  branch?: string;
  /** Required start of the message, e.g. the issue key from the branch name. */
  prefix?: string;
}

/** Keeps the prompt well inside small context windows; the model still sees which files were cut. */
const MAX_DIFF_CHARS = 40_000;

/** Writes a commit message with a language model registered in VS Code (Copilot or any other provider). */
export async function generateCommitMessage(context: MessageContext, token: vscode.CancellationToken): Promise<string> {
  if (!context.diff.trim()) throw new Error('There are no changes to describe.');
  const model = await pickModel();

  const response = await model.sendRequest([vscode.LanguageModelChatMessage.User(prompt(context))], {
    justification: 'Jetik writes a commit message from the changes you selected.',
  }, token);
  let text = '';
  for await (const fragment of response.text) text += fragment;

  const message = clean(text);
  if (!message) throw new Error('The language model returned an empty message.');
  const prefix = context.prefix?.trim();
  return prefix && !message.startsWith(prefix) ? `${context.prefix}${message}` : message;
}

async function pickModel(): Promise<vscode.LanguageModelChat> {
  const models = await vscode.lm.selectChatModels();
  if (models.length === 0) {
    throw new Error('No language model is available. Install GitHub Copilot Chat or another extension that provides models to VS Code.');
  }
  const wanted = settings.commitMessageModel().toLowerCase();
  if (!wanted) return models[0];
  const match = models.find((model) => [model.id, model.family, model.name].some((field) => field.toLowerCase().includes(wanted)));
  if (!match) {
    throw new Error(`No language model matches '${wanted}'. Available: ${models.map((model) => model.family).join(', ')}.`);
  }
  return match;
}

function prompt(context: MessageContext): string {
  const diff =
    context.diff.length > MAX_DIFF_CHARS ? `${context.diff.slice(0, MAX_DIFF_CHARS)}\n… (diff truncated)` : context.diff;
  const history = context.recentMessages.length > 0;
  const lines = [
    'Write a git commit message for the diff below.',
    '',
    'Rules:',
    history
      ? '- Follow the style of the recent commits of this repository exactly: the same language, tone, mood, capitalization, ' +
        'prefixes or scopes (e.g. "feat:", "[ABC-12]"), subject length, and whether and how they write a body. ' +
        'Their convention wins over the defaults below.'
      : '- No history yet: write a concise imperative summary line.',
    '- Keep the first line under 72 characters, with no trailing period unless the history uses one.',
    '- Add a body after a blank line only when the change needs explaining and the history does that too; say why, not how.',
    '- Do not mention file names unless that is the clearest way to describe the change.',
    '- Reply with the message only: no quotes, no code fences, no commentary.',
  ];
  if (context.branch) {
    lines.push(
      `- The commit goes to the branch "${context.branch}". Use its name to understand the intent of the work ` +
        '(a feature, a fix, an issue key) and the type or scope prefix if the history uses them, ' +
        'but describe what this diff actually does.',
    );
  }
  if (context.prefix?.trim()) lines.push(`- The message must start with "${context.prefix}".`);
  const extra = settings.commitMessageInstructions().trim();
  if (extra) lines.push('', 'Additional instructions (they override the style rules above):', extra);
  if (history) {
    lines.push('', 'Recent commits, newest first, separated by "---":', context.recentMessages.map(clip).join('\n---\n'));
  }
  lines.push('', 'Diff:', diff);
  return lines.join('\n');
}

/** Long bodies say little more about style than their start does. */
function clip(message: string): string {
  return message.length > 600 ? `${message.slice(0, 600)}…` : message;
}

/** Drops code fences and surrounding quotes some models add despite the instructions. */
function clean(text: string): string {
  return text
    .trim()
    .replace(/^```[\w-]*\n([\s\S]*?)\n?```$/, '$1')
    .replace(/^"([\s\S]*)"$/, '$1')
    .trim();
}
