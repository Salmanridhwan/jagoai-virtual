import { describe, expect, it } from 'vitest';
import type { Definition, Run } from './api';
import { workflowGraph } from './graph';

const definition: Definition = {
	schema: 1,
	source: { kind: 'manual' },
	steps: [
		{
			id: 'decision',
			name: 'Choose branch',
			kind: 'condition',
			inputs: {},
			then: [{ id: 'draft', name: 'Draft', kind: 'create_draft', inputs: {} }],
			else: [
				{ id: 'prepare', name: 'Prepare', kind: 'text', inputs: {} },
				{ id: 'alternative', name: 'Alternative', kind: 'create_draft', inputs: {} }
			]
		},
		{ id: 'review', name: 'Review', kind: 'approval', inputs: {} }
	]
};

describe('workflow diagram', () => {
	it('joins both branches before the next step and separates their rows', () => {
		const graph = workflowGraph(definition);
		const node = (id: string) => graph.nodes.find((candidate) => candidate.id === id)!;
		expect(graph.edges.map(({ source, target, port }) => ({ source, target, port }))).toEqual([
			{ source: 'source', target: 'decision', port: 'after' },
			{ source: 'decision', target: 'draft', port: 'then' },
			{ source: 'decision', target: 'prepare', port: 'else' },
			{ source: 'prepare', target: 'alternative', port: 'after' },
			{ source: 'draft', target: 'review', port: 'after' },
			{ source: 'alternative', target: 'review', port: 'after' }
		]);
		expect(node('draft').x).toBe(node('prepare').x);
		expect(node('draft').y).toBeLessThan(node('decision').y);
		expect(node('prepare').y).toBeGreaterThan(node('decision').y);
		expect(node('review').x).toBeGreaterThan(node('alternative').x);
		expect(node('review').y).toBe(node('decision').y);
	});

	it('preserves step outcomes and editor issues on their respective nodes', () => {
		const run: Run = {
			id: 'run',
			workspace_id: 'workspace',
			workflow_id: 'workflow',
			workflow_name: 'Launch',
			workflow_revision: 1,
			revision: 4,
			definition,
			source: {},
			state: 'failed',
			mode: 'preview',
			created_at: '2026-10-14T00:00:00Z',
			updated_at: '2026-10-14T00:00:01Z',
			steps: [
				{
					step_id: 'decision',
					kind: 'condition',
					name: 'Choose branch',
					state: 'succeeded',
					inputs: {},
					output: {},
					started_at: '2026-10-14T00:00:00Z'
				},
				{
					step_id: 'draft',
					kind: 'create_draft',
					name: 'Draft',
					state: 'failed',
					inputs: {},
					output: {},
					started_at: '2026-10-14T00:00:00Z'
				}
			]
		};
		expect(
			workflowGraph(definition, run).nodes.find((node) => node.id === 'draft')!.issues
		).toBeGreaterThan(0);
		const graph = workflowGraph(definition, run, [
			{ node: 'source', field: 'url', message: 'Source missing' },
			{ node: 'draft', field: 'text', message: 'Text missing' },
			{ node: 'draft', field: 'destinations', message: 'Destination missing' }
		]);
		expect(graph.nodes.map(({ id, state, issues }) => ({ id, state, issues }))).toEqual([
			{ id: 'source', state: 'succeeded', issues: 1 },
			{ id: 'decision', state: 'succeeded', issues: 0 },
			{ id: 'draft', state: 'failed', issues: 2 },
			{ id: 'prepare', state: undefined, issues: 0 },
			{ id: 'alternative', state: undefined, issues: 0 },
			{ id: 'review', state: undefined, issues: 0 }
		]);
	});
});
