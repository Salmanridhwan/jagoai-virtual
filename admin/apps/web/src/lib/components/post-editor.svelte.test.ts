import { expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { userEvent } from 'vitest/browser';
import PostEditor from '@openpost/ui/components/post-editor';
import '../../routes/layout.css';

it('emits the complete reusable mention snapshot when creating from the picker', async () => {
	const onchange = vi.fn();
	const target = {
		provider: 'workspace' as const,
		kind: 'profile' as const,
		id: 'saved',
		profiles: [{ provider: 'x', text: '@guest_x' }]
	};
	const screen = await render(PostEditor, {
		id: 'post-text',
		label: 'Post text',
		value: { body: 'Hi ' },
		onchange,
		minimumQueryLength: 0,
		lookup: async () => [],
		oncreate: (_query, complete) => complete({ label: '@guest', detail: '', target })
	});
	const editor = screen.getByRole('textbox', { name: 'Post text' });
	await editor.click();
	await userEvent.keyboard('{ControlOrMeta>}{End}{/ControlOrMeta}@');
	await screen.getByRole('option', { name: 'Add mention' }).click();
	expect(onchange.mock.lastCall?.[0]).toEqual({
		body: 'Hi @guest ',
		mentions: [{ start: 3, end: 9, text: '@guest', target }]
	});
});

for (const result of ['empty', 'denied'] as const) {
	it(`keeps vertical caret movement when mention search is ${result}`, async () => {
		const onchange = vi.fn();
		const screen = await render(PostEditor, {
			id: 'post-text',
			label: 'Post text',
			value: { body: 'First line with enough words\n' },
			onchange,
			lookup: async () => {
				if (result === 'denied') throw { status: 403 };
				return [];
			}
		});
		const editor = screen.getByRole('textbox', { name: 'Post text' });
		await editor.click();
		await userEvent.keyboard('{ControlOrMeta>}{End}{/ControlOrMeta}@unknown');
		await expect
			.element(
				screen.getByText(
					result === 'empty'
						? 'No matching accounts'
						: 'The provider has not granted mention search access. Check the account and app permissions.'
				)
			)
			.toBeVisible();
		await userEvent.keyboard('{ArrowUp}X');
		expect(onchange.mock.lastCall?.[0].body.split('\n')[1]).toBe('@unknown');
		expect(onchange.mock.lastCall?.[0].body.split('\n')[0]).toContain('X');
	});
}

it.runIf(/Mac|iPhone|iPad/.test(navigator.platform))(
	'preserves Mac Control+B caret movement while suppressing rich formatting',
	async () => {
		const screen = await render(PostEditor, {
			id: 'post-text',
			label: 'Post text',
			value: { body: 'Text' },
			onchange: vi.fn()
		});
		const editor = screen.getByRole('textbox', { name: 'Post text' });
		await editor.click();
		await userEvent.keyboard('{ControlOrMeta>}{End}{/ControlOrMeta}');
		const offset = () => window.getSelection()?.anchorOffset;
		const end = offset();
		await userEvent.keyboard('{Control>}b{/Control}');
		expect(offset()).toBe((end ?? 0) - 1);
	}
);
