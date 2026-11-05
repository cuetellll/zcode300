import { describe, expect, it } from 'vitest';
import { fa } from '../src/i18n/fa';
import { en } from '../src/i18n/en';

describe('i18n dictionaries', () => {
  it('fa and en expose exactly the same keys', () => {
    const faKeys = Object.keys(fa).sort();
    const enKeys = Object.keys(en).sort();
    expect(faKeys).toEqual(enKeys);
  });

  it('has no empty translations', () => {
    for (const [key, value] of Object.entries(fa)) {
      expect(value.trim().length, `fa.${key} is empty`).toBeGreaterThan(0);
    }
    for (const [key, value] of Object.entries(en)) {
      expect(value.trim().length, `en.${key} is empty`).toBeGreaterThan(0);
    }
  });
});
