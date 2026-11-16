/**
 * File icons for the webviews, taken from the VS Code file icon theme the user has active.
 * The host reduces the theme file to `FileIconTheme`; the webview picks an icon per file name.
 */

export interface FileIconDefinition {
  /** Image, relative to the theme file. */
  iconPath?: string;
  /** Glyph of one of the theme's fonts, written as a CSS escape such as `\E001`. */
  fontCharacter?: string;
  fontColor?: string;
  fontSize?: string;
  /** Defaults to the theme's first font. */
  fontId?: string;
}

export interface FileIconFont {
  id: string;
  src: { path: string; format: string }[];
  weight?: string;
  style?: string;
  size?: string;
}

/** Icon ids by what they match. */
export interface FileIconAssociations {
  /** Icon of a file that nothing else matches. */
  file?: string;
  /** Keyed by lower-case file name. */
  fileNames?: Record<string, string>;
  /** Keyed by lower-case extension without the leading dot; `test.ts` is more specific than `ts`. */
  fileExtensions?: Record<string, string>;
  languageIds?: Record<string, string>;
}

export interface FileIconTheme extends FileIconAssociations {
  /** URL of the theme file; `iconPath` and font paths resolve against it. */
  base: string;
  fonts: FileIconFont[];
  iconDefinitions: Record<string, FileIconDefinition>;
  /** Overrides for light and for high contrast color themes. */
  light?: FileIconAssociations;
  highContrast?: FileIconAssociations;
  /** Language ids by lower-case file name and extension, for `languageIds`. */
  languages: { fileNames: Record<string, string>; extensions: Record<string, string> };
}

/** `null`: file icons are turned off. `'generic'`: the theme is out of reach, draw a plain file glyph. */
export type FileIcons = FileIconTheme | 'generic' | null;

export type ColorScheme = 'dark' | 'light' | 'highContrast';

/** A language as extensions declare it in `contributes.languages`. */
export interface LanguageContribution {
  id?: string;
  extensions?: string[];
  filenames?: string[];
}

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The string-valued fields of `value` named in `keys`. */
function strings<K extends string>(value: Json, keys: readonly K[]): { [P in K]?: string } {
  const result: { [P in K]?: string } = {};
  for (const key of keys) {
    const field = value[key];
    if (typeof field === 'string') result[key] = field;
  }
  return result;
}

function idMap(value: unknown, lowerCaseKeys: boolean): Record<string, string> | undefined {
  if (!isObject(value)) return undefined;
  const entries = Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string');
  if (entries.length === 0) return undefined;
  return Object.fromEntries(lowerCaseKeys ? entries.map(([key, id]) => [key.toLowerCase(), id]) : entries);
}

function associations(value: unknown): FileIconAssociations | undefined {
  if (!isObject(value)) return undefined;
  const languageIds = idMap(value.languageIds, false);
  // VS Code gives JSON with comments the JSON icon unless the theme says otherwise.
  if (languageIds && own(languageIds, 'json') && !own(languageIds, 'jsonc')) languageIds.jsonc = languageIds.json;
  return {
    ...strings(value, ['file']),
    fileNames: idMap(value.fileNames, true),
    fileExtensions: idMap(value.fileExtensions, true),
    languageIds,
  };
}

function font(value: unknown): FileIconFont[] {
  if (!isObject(value) || typeof value.id !== 'string' || !Array.isArray(value.src)) return [];
  const src = value.src.flatMap((source) => {
    const { path, format } = isObject(source) ? strings(source, ['path', 'format']) : {};
    return path && format ? [{ path, format }] : [];
  });
  return [{ id: value.id, src, ...strings(value, ['weight', 'style', 'size']) }];
}

/**
 * Reduces a parsed file icon theme to what picking file icons needs: folder icons, unused
 * definitions and languages the theme has no icon for are left out.
 */
export function compactFileIconTheme(document: unknown, languages: readonly LanguageContribution[]): Omit<FileIconTheme, 'base'> {
  const root = isObject(document) ? document : {};
  const base = associations(root) ?? {};
  const light = associations(root.light);
  const highContrast = associations(root.highContrast);

  const usedIcons = new Set<string>();
  const usedLanguages = new Set<string>();
  for (const variant of [base, light, highContrast]) {
    if (!variant) continue;
    if (variant.file) usedIcons.add(variant.file);
    for (const map of [variant.fileNames, variant.fileExtensions, variant.languageIds]) {
      for (const id of Object.values(map ?? {})) usedIcons.add(id);
    }
    for (const language of Object.keys(variant.languageIds ?? {})) usedLanguages.add(language);
  }

  const iconDefinitions: Record<string, FileIconDefinition> = {};
  for (const [id, definition] of Object.entries(isObject(root.iconDefinitions) ? root.iconDefinitions : {})) {
    if (!usedIcons.has(id) || !isObject(definition)) continue;
    iconDefinitions[id] = strings(definition, ['iconPath', 'fontCharacter', 'fontColor', 'fontSize', 'fontId']);
  }

  // The first extension to claim a file name or an extension keeps it.
  const fileNames = new Map<string, string>();
  const extensions = new Map<string, string>();
  const claim = (map: Map<string, string>, key: string, language: string) => {
    if (!map.has(key)) map.set(key, language);
  };
  for (const language of languages) {
    if (!language.id || !usedLanguages.has(language.id)) continue;
    for (const name of language.filenames ?? []) claim(fileNames, name.toLowerCase(), language.id);
    for (const extension of language.extensions ?? []) claim(extensions, extension.toLowerCase().replace(/^\./, ''), language.id);
  }

  return {
    ...base,
    light,
    highContrast,
    fonts: Array.isArray(root.fonts) ? root.fonts.flatMap(font) : [],
    iconDefinitions,
    languages: { fileNames: Object.fromEntries(fileNames), extensions: Object.fromEntries(extensions) },
  };
}

/** Own property lookup: file names such as `constructor` must not hit `Object.prototype`. */
function own<T>(map: Record<string, T> | undefined, key: string): T | undefined {
  return map !== undefined && Object.hasOwn(map, key) ? map[key] : undefined;
}

/** `graph.test.ts` → `test.ts`, `ts`: what follows each dot, longest first. */
function extensionsOf(name: string): string[] {
  const segments = name.split('.');
  return segments.slice(1).map((_, index) => segments.slice(index + 1).join('.'));
}

/**
 * Picks the icon the way the VS Code explorer does: by file name, then by the longest matching
 * extension, then by language, then the theme's default. `undefined` when the theme has none.
 */
export function resolveFileIcon(theme: FileIconTheme, fileName: string, scheme: ColorScheme): FileIconDefinition | undefined {
  const name = fileName.toLowerCase();
  const extensions = extensionsOf(name);
  const override = scheme === 'light' ? theme.light : scheme === 'highContrast' ? theme.highContrast : undefined;

  const find = (kind: 'fileNames' | 'fileExtensions' | 'languageIds', keys: readonly string[]): string | undefined => {
    for (const key of keys) {
      const id = own(override?.[kind], key) ?? own(theme[kind], key);
      if (id !== undefined) return id;
    }
    return undefined;
  };
  const languageOf = (): string[] => {
    const byName = own(theme.languages.fileNames, name);
    if (byName !== undefined) return [byName];
    return extensions.flatMap((extension) => own(theme.languages.extensions, extension) ?? []).slice(0, 1);
  };

  const id = find('fileNames', [name]) ?? find('fileExtensions', extensions) ?? find('languageIds', languageOf()) ?? override?.file ?? theme.file;
  return id === undefined ? undefined : own(theme.iconDefinitions, id);
}
