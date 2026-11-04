import { describe, expect, it } from 'vitest';
import { offlineTranslations } from './offline-translations';
import { getLocaleTag, localeLabels } from './i18n';

describe('locale formatting', () => {
	it('uses Russian conventions and offers Russian offline recovery', () => {
		const locale = getLocaleTag('ru');
		expect(localeLabels.ru).toBe('Русский');
		expect(new Intl.NumberFormat(locale).formatToParts(12345.6)).toEqual(
			expect.arrayContaining([
				{ type: 'integer', value: '12' },
				{ type: 'integer', value: '345' },
				{ type: 'decimal', value: ',' },
				{ type: 'fraction', value: '6' }
			])
		);
		expect(
			new Intl.DateTimeFormat(locale, {
				day: 'numeric',
				month: 'long',
				year: 'numeric',
				timeZone: 'UTC'
			}).formatToParts(new Date('2026-10-14T12:00:00Z'))
		).toEqual(
			expect.arrayContaining([
				{ type: 'day', value: '14' },
				{ type: 'month', value: 'октября' },
				{ type: 'year', value: '2026' }
			])
		);
		expect(offlineTranslations.ru).toEqual([
			'Нет подключения',
			'Эта страница пока недоступна на этом устройстве. Подключитесь к интернету, чтобы открыть её. Сохранённые локальные проекты остаются на устройстве.',
			'Попробовать ещё раз'
		]);
	});
	it('uses Italian conventions for numbers and dates', () => {
		const locale = getLocaleTag('it');

		expect(new Intl.NumberFormat(locale).format(12345.6)).toBe('12.345,6');
		expect(
			new Intl.DateTimeFormat(locale, {
				day: 'numeric',
				month: 'long',
				year: 'numeric',
				timeZone: 'UTC'
			}).format(new Date('2026-10-14T12:00:00Z'))
		).toBe('14 ottobre 2026');
	});
});
