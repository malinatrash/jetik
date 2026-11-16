import { resolveFileIcon, type ColorScheme, type FileIconTheme, type FileIcons } from '../../src/protocol/fileIcons';
import { Icon } from './Icon';
import { Store, useStore } from './store';

/** Put into the page by the host, see `Webviews.html`. */
const icons = JSON.parse(document.getElementById('file-icons')?.textContent || 'null') as FileIcons;

const fontFamily = (id: string) => `file-icons-${id}`;
const url = (theme: FileIconTheme, path: string) => new URL(path, theme.base).href;

/** Glyphs are written as CSS escapes: `\E001`. */
const glyph = (character: string) =>
  character.replace(/\\([0-9a-f]{1,6}) ?/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)));

function fontFaces(theme: FileIconTheme): string {
  const keyword = (value: string | undefined) => (value && /^[\w -]+$/.test(value) ? value : 'normal');
  return theme.fonts
    .map((font) => {
      const src = font.src.map((source) => `url(${JSON.stringify(url(theme, source.path))}) format(${JSON.stringify(source.format)})`);
      return `@font-face { font-family: ${JSON.stringify(fontFamily(font.id))}; src: ${src.join(', ')}; font-weight: ${keyword(font.weight)}; font-style: ${keyword(font.style)}; font-display: block; }`;
    })
    .join('\n');
}

if (icons && icons !== 'generic' && icons.fonts.length > 0) {
  document.head.appendChild(document.createElement('style')).textContent = fontFaces(icons);
}

/** VS Code marks the kind of the color theme with a class on `<body>` and swaps it when the theme changes. */
const currentScheme = (): ColorScheme => {
  const classes = document.body.classList;
  return classes.contains('vscode-high-contrast') ? 'highContrast' : classes.contains('vscode-light') ? 'light' : 'dark';
};

class SchemeStore extends Store<{ scheme: ColorScheme }> {
  constructor() {
    super({ scheme: currentScheme() });
    new MutationObserver(() => {
      const scheme = currentScheme();
      if (scheme !== this.state.scheme) this.set({ scheme });
    }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }
}

const schemes = new SchemeStore();

/** The icon the active file icon theme has for the file; nothing when file icons are turned off. */
export function FileIcon({ path }: { path: string }) {
  const { scheme } = useStore(schemes);
  if (icons === null) return null;
  if (icons === 'generic') return <Icon name="file" />;

  const icon = resolveFileIcon(icons, path.slice(path.lastIndexOf('/') + 1), scheme);
  if (icon?.iconPath) return <img class="file-icon" src={url(icons, icon.iconPath)} alt="" />;
  if (icon?.fontCharacter) {
    const font = icons.fonts.find((candidate) => candidate.id === icon.fontId) ?? icons.fonts[0];
    return (
      <span class="file-icon" style={{ fontFamily: font && fontFamily(font.id), fontSize: icon.fontSize ?? font?.size, color: icon.fontColor }}>
        {glyph(icon.fontCharacter)}
      </span>
    );
  }
  // Keeps the names aligned when the theme has no icon for this file.
  return <span class="file-icon" />;
}
