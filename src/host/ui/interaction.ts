import * as vscode from 'vscode';

export interface PickOption<T> {
  label: string;
  description?: string;
  detail?: string;
  value: T;
}

export interface MessageEditRequest {
  title: string;
  initial: string;
  confirmLabel: string;
}

/** Something that can show a multi-line commit message editor (the log webview). */
export interface MessageEditor {
  editMessage(request: MessageEditRequest): Promise<string | undefined> | undefined;
}

/** Everything actions need to talk to the user; keeps them free of direct `vscode.window` calls. */
export interface Interaction {
  confirm(message: string, detail: string, confirmLabel: string): Promise<boolean>;
  choose<T extends string>(message: string, detail: string, ...choices: T[]): Promise<T | undefined>;
  input(options: { title: string; value?: string; placeholder?: string; validate?(value: string): string | undefined }): Promise<string | undefined>;
  pick<T>(title: string, options: PickOption<T>[]): Promise<T | undefined>;
  /** Asks for a new branch name with a "checkout" toggle, like the IntelliJ New Branch dialog. */
  branchName(title: string, existing: readonly string[], initial?: string): Promise<{ name: string; checkout: boolean } | undefined>;
  editMessage(request: MessageEditRequest): Promise<string | undefined>;
  info(message: string): void;
  copy(text: string): Promise<void>;
}

export function validateBranchName(name: string, existing: readonly string[]): string | undefined {
  if (!name) return 'Enter a branch name';
  if (/[\s~^:?*[\\]|\.\.|@\{|^[-/.]|[/.]$|\/\/|\.lock$/.test(name)) return 'Not a valid branch name';
  if (existing.includes(name)) return `Branch '${name}' already exists`;
  return undefined;
}

export class VsCodeInteraction implements Interaction {
  /** Set by the log view once it can host the message editor. */
  messageEditor?: MessageEditor;

  async confirm(message: string, detail: string, confirmLabel: string): Promise<boolean> {
    return (await vscode.window.showWarningMessage(message, { modal: true, detail }, confirmLabel)) === confirmLabel;
  }

  async choose<T extends string>(message: string, detail: string, ...choices: T[]): Promise<T | undefined> {
    return vscode.window.showWarningMessage(message, { modal: true, detail }, ...choices);
  }

  async input(options: { title: string; value?: string; placeholder?: string; validate?(value: string): string | undefined }): Promise<string | undefined> {
    const value = await vscode.window.showInputBox({
      title: options.title,
      value: options.value,
      placeHolder: options.placeholder,
      validateInput: options.validate,
    });
    return value?.trim() || undefined;
  }

  async pick<T>(title: string, options: PickOption<T>[]): Promise<T | undefined> {
    return (await vscode.window.showQuickPick(options, { title }))?.value;
  }

  branchName(title: string, existing: readonly string[], initial = ''): Promise<{ name: string; checkout: boolean } | undefined> {
    return new Promise((resolve) => {
      const box = vscode.window.createInputBox();
      let checkout = true;
      const render = () => {
        box.buttons = [
          {
            iconPath: new vscode.ThemeIcon(checkout ? 'pass-filled' : 'circle-large-outline'),
            tooltip: checkout ? 'Checkout branch: on' : 'Checkout branch: off',
          },
        ];
        box.prompt = checkout ? 'The new branch will be checked out (toggle with the button)' : 'The branch will be created without checkout';
      };
      box.title = title;
      box.value = initial;
      box.placeholder = 'New branch name';
      render();
      box.onDidTriggerButton(() => {
        checkout = !checkout;
        render();
      });
      box.onDidChangeValue((value) => {
        box.validationMessage = value ? validateBranchName(value.trim(), existing) : undefined;
      });
      box.onDidAccept(() => {
        const name = box.value.trim();
        const problem = validateBranchName(name, existing);
        if (problem) {
          box.validationMessage = problem;
          return;
        }
        resolve({ name, checkout });
        box.hide();
      });
      box.onDidHide(() => {
        resolve(undefined);
        box.dispose();
      });
      box.show();
    });
  }

  async editMessage(request: MessageEditRequest): Promise<string | undefined> {
    const edited = this.messageEditor?.editMessage(request);
    if (edited) return edited;
    // The log view is not on screen: fall back to a single-line input for the subject.
    const [subject, ...rest] = request.initial.split('\n');
    const value = await this.input({ title: request.title, value: subject });
    return value === undefined ? undefined : [value, ...rest].join('\n');
  }

  info(message: string): void {
    vscode.window.setStatusBarMessage(`$(check) ${message}`, 5000);
  }

  async copy(text: string): Promise<void> {
    await vscode.env.clipboard.writeText(text);
  }
}
