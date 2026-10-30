import type { Language } from '../../utils/language.js';

const labels = {
  service: { en: 'Service', 'zh-CN': '服务', 'zh-HK': '服務' },
  branch: { en: 'Salon branch', 'zh-CN': '分店', 'zh-HK': '分店' },
};

// Notification copy must not borrow another locale's name when a translation
// is absent. Keep explicit translations; otherwise use a localized label.
export function notificationName(translations: unknown, language: Language, base: string, kind: keyof typeof labels): string {
  if (translations && typeof translations === 'object' && !Array.isArray(translations)) {
    const entry = (translations as Record<string, unknown>)[language];
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      const name = (entry as Record<string, unknown>).name;
      if (typeof name === 'string' && name.trim()) return name;
    }
  }
  if (language === 'en' && base.trim() && !/\p{Script=Han}/u.test(base)) return base;
  return labels[kind][language];
}
