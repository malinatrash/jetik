export function Icon({ name, title }: { name: string; title?: string }) {
  return <i class={`codicon codicon-${name}`} title={title} />;
}
