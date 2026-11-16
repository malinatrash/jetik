import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compactFileIconTheme, resolveFileIcon, type FileIconTheme } from '../src/protocol/fileIcons';

const document = {
  iconDefinitions: {
    file: { iconPath: './icons/file.svg' },
    'file-light': { iconPath: './icons/file-light.svg' },
    ts: { iconPath: './icons/ts.svg' },
    'ts-light': { iconPath: './icons/ts-light.svg' },
    test: { iconPath: './icons/test.svg' },
    lock: { iconPath: './icons/lock.svg' },
    go: { fontCharacter: '\\E001', fontColor: '#519aba', bogus: 1 },
    json: { iconPath: './icons/json.svg' },
    folder: { iconPath: './icons/folder.svg' },
    unused: { iconPath: './icons/unused.svg' },
  },
  fonts: [{ id: 'glyphs', src: [{ path: './glyphs.woff', format: 'woff' }, { path: 1 }], size: '150%' }],
  file: 'file',
  folder: 'folder',
  folderNames: { src: 'folder' },
  fileExtensions: { ts: 'ts', 'Test.TS': 'test' },
  fileNames: { 'Package-Lock.json': 'lock' },
  languageIds: { go: 'go', json: 'json' },
  light: { file: 'file-light', fileExtensions: { ts: 'ts-light' } },
};
const languages = [
  { id: 'go', extensions: ['.go'], filenames: ['go.work'] },
  { id: 'json', extensions: ['.json', '.webmanifest'] },
  { id: 'jsonc', extensions: ['.jsonc'] },
  { id: 'other', extensions: ['.go', '.zig'] },
  { extensions: ['.nameless'] },
];
const theme: FileIconTheme = { ...compactFileIconTheme(document, languages), base: 'https://host/theme/dist/theme.json' };

test('compactFileIconTheme keeps what file icons need and nothing else', () => {
  assert.deepEqual(Object.keys(theme.iconDefinitions).sort(), ['file', 'file-light', 'go', 'json', 'lock', 'test', 'ts', 'ts-light']);
  assert.deepEqual(theme.iconDefinitions.go, { fontCharacter: '\\E001', fontColor: '#519aba' });
  assert.deepEqual(theme.fonts, [{ id: 'glyphs', src: [{ path: './glyphs.woff', format: 'woff' }], size: '150%' }]);
  assert.deepEqual(theme.fileExtensions, { ts: 'ts', 'test.ts': 'test' });
  assert.deepEqual(theme.fileNames, { 'package-lock.json': 'lock' });
  assert.deepEqual(theme.languageIds, { go: 'go', json: 'json', jsonc: 'json' });
  assert.deepEqual(theme.languages, {
    fileNames: { 'go.work': 'go' },
    extensions: { go: 'go', json: 'json', webmanifest: 'json', jsonc: 'jsonc' },
  });
  assert.equal('folderNames' in theme, false);
  assert.equal(theme.highContrast, undefined);
});

test('compactFileIconTheme survives a malformed theme', () => {
  for (const broken of [null, [], 'theme', { iconDefinitions: [], fonts: {}, fileNames: 'x', light: 3 }]) {
    const compact = { ...compactFileIconTheme(broken, languages), base: '' };
    assert.equal(resolveFileIcon(compact, 'main.ts', 'dark'), undefined);
  }
});

test('resolveFileIcon prefers the file name, then the longest extension, then the language', () => {
  const icon = (name: string) => resolveFileIcon(theme, name, 'dark');
  assert.equal(icon('package-lock.json')?.iconPath, './icons/lock.svg');
  assert.equal(icon('Package-Lock.JSON')?.iconPath, './icons/lock.svg');
  assert.equal(icon('graph.test.ts')?.iconPath, './icons/test.svg');
  assert.equal(icon('layout.ts')?.iconPath, './icons/ts.svg');
  assert.equal(icon('main.go')?.fontCharacter, '\\E001');
  assert.equal(icon('go.work')?.fontCharacter, '\\E001');
  assert.equal(icon('site.webmanifest')?.iconPath, './icons/json.svg');
  assert.equal(icon('settings.jsonc')?.iconPath, './icons/json.svg');
  assert.equal(icon('build.zig')?.iconPath, './icons/file.svg');
  assert.equal(icon('Makefile')?.iconPath, './icons/file.svg');
  assert.equal(icon('.gitignore')?.iconPath, './icons/file.svg');
});

test('resolveFileIcon does not mistake Object.prototype members for associations', () => {
  for (const name of ['constructor', 'toString', 'x.constructor', '__proto__']) {
    assert.equal(resolveFileIcon(theme, name, 'dark')?.iconPath, './icons/file.svg');
  }
});

test('light and high contrast override single associations and fall back to the base theme', () => {
  assert.equal(resolveFileIcon(theme, 'layout.ts', 'light')?.iconPath, './icons/ts-light.svg');
  assert.equal(resolveFileIcon(theme, 'graph.test.ts', 'light')?.iconPath, './icons/test.svg');
  assert.equal(resolveFileIcon(theme, 'notes.txt', 'light')?.iconPath, './icons/file-light.svg');
  assert.equal(resolveFileIcon(theme, 'layout.ts', 'highContrast')?.iconPath, './icons/ts.svg');
});
