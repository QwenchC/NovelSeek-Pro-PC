import type { UiLanguage } from '@typings/index';

export function tx(language: UiLanguage, zh: string, en: string): string {
  return language === 'en' ? en : zh;
}

