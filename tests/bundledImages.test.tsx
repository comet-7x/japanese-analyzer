import React from 'react';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import Header from '../app/components/Header';
import { ProviderLogo } from '../app/components/ProviderLogo';
import { ThemeProvider } from '../app/contexts/ThemeContext';
import { LanguageProvider } from '../app/contexts/LanguageContext';
import { PROVIDER_ICONS } from '../app/lib/providerIcons';

// Desktop resources are sealed by codesign: bundled UI images must not invoke
// the runtime image optimizer, which writes .next/cache inside the app bundle.
Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
const header = renderToStaticMarkup(<LanguageProvider><ThemeProvider><Header thinking={false} services={[]} activeServiceId="" activeModelId="" onSelectModel={() => {}} /></ThemeProvider></LanguageProvider>);
for (const source of ['/logo/logo-text.webp', '/logo/logo-text-dark.webp']) {
  assert.ok(header.includes(`src="${source}"`), `Brand image is served directly: ${source}`);
}
assert.ok(!header.includes('/_next/image'), 'Header never creates a runtime image cache');
for (const [id, source] of Object.entries(PROVIDER_ICONS)) {
  const html = renderToStaticMarkup(<ProviderLogo profile={{ id, name: id }} />);
  assert.ok(html.includes(`src="${source}"`), `Provider icon is served directly: ${id}`);
  assert.ok(!html.includes('/_next/image'), `Provider icon never creates a runtime image cache: ${id}`);
}
console.log('Bundled images render directly without a writable image cache');
