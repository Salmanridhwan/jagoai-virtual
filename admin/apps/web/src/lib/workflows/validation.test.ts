import { expect, it } from 'vitest';
import type { Definition, Step } from './api';
import { workflowIssues } from './validation';

function textStep(id: string, reference: string): Step {
	return {
		id,
		kind: 'text',
		name: id,
		inputs: { text: { reference }, operation: { literal: 'trim' } }
	};
}

it('validates each node against its preceding outputs and its own branch scope', () => {
	const definition: Definition = {
		schema: 1,
		source: { kind: 'manual' },
		steps: [
			textStep('prepare', 'source["release.title"]'),
			{
				id: 'gate',
				kind: 'condition',
				name: 'Gate',
				inputs: {
					left: { reference: 'prepare.text' },
					operator: { literal: 'contains' },
					right: { literal: 'Release' }
				},
				then: [textStep('inside', 'gate.matched'), textStep('follow', 'inside.text')],
				else: [textStep('opposite', 'inside.text')]
			},
			textStep('after', 'inside.text'),
			textStep('self', 'self.text'),
			textStep('nested', 'source.release.title')
		]
	};
	const issues = workflowIssues(definition, { 'release.title': 'Release' });
	expect(issues.map(({ node, field }) => ({ node, field }))).toEqual([
		{ node: 'opposite', field: 'text' },
		{ node: 'after', field: 'text' },
		{ node: 'self', field: 'text' },
		{ node: 'nested', field: 'text' }
	]);
});

it('refreshes discovered source fields when the sample changes', () => {
	const definition: Definition = {
		schema: 1,
		source: { kind: 'manual' },
		steps: [textStep('first', 'source.title')]
	};
	expect(workflowIssues(definition, { title: 'Release' })).toEqual([]);
	expect(
		workflowIssues(definition, { body: 'Release' }).map(({ node, field }) => ({
			node,
			field
		}))
	).toEqual([{ node: 'first', field: 'text' }]);
});
