import type { Root } from 'mdast';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';

/** A human instruction for the Agent, anchored to a Block rather than a line. */
export type Comment = { id: string; body: string };

/** What a Block is, which decides how it is drawn. */
export type Kind =
	| 'heading'
	| 'paragraph'
	| 'list'
	| 'blockquote'
	| 'table'
	| 'code'
	| 'mermaid'
	| 'definition'
	| 'other';

export type Block = {
	id: string;
	kind: Kind;
	/** This Block's markdown, exactly as it appears in the file. */
	source: string;
	/** What separates this Block from the next. Kept so an untouched document rewrites byte for byte. */
	gap: string;
	/** The fence language, shown alongside a code sample. */
	language: string | null;
	comments: Comment[];
};

export type Document = {
	/** Whatever sits before the first Block — usually nothing. */
	prelude: string;
	blocks: Block[];
};

const parser = unified().use(remarkParse).use(remarkGfm);

let sequence = 0;
const nextId = () => `b${++sequence}`;

const newlines = (text: string) => (text.match(/\n/g) ?? []).length;

export function parseDocument(text: string): Document {
	const tree = parser.parse(text) as Root;
	const nodes = tree.children.filter((node) => node.position?.start.offset !== undefined);
	if (nodes.length === 0) return { prelude: text, blocks: [] };

	const prelude = text.slice(0, nodes[0].position!.start.offset!);
	const blocks = nodes.map((node, index) => {
		const from = node.position!.start.offset!;
		const to = node.position!.end.offset!;
		const next = index + 1 < nodes.length ? nodes[index + 1].position!.start.offset! : text.length;
		const language = node.type === 'code' ? (node.lang ?? '') : null;
		return {
			id: nextId(),
			kind: kindOf(node.type, language),
			source: text.slice(from, to),
			gap: text.slice(to, next),
			language,
			comments: []
		};
	});
	return { prelude, blocks };
}

/** Definitions supplied as render context, never as part of another Block's source. */
export function referenceDefinitionSource(document: Document): string {
	return document.blocks
		.filter((block) => block.kind === 'definition')
		.map((block) => block.source)
		.join('\n\n');
}

function kindOf(type: string, language: string | null): Kind {
	if (type === 'code') return language === 'mermaid' ? 'mermaid' : 'code';
	const known: Kind[] = ['heading', 'paragraph', 'list', 'blockquote', 'table', 'definition'];
	return known.find((kind) => kind === type) ?? 'other';
}

/** The text inside a fence, without its ``` lines. */
export function fenceBody(source: string): string {
	const lines = source.split('\n');
	const closed = /^\s*(```|~~~)/.test(lines[lines.length - 1] ?? '');
	return lines.slice(1, closed ? -1 : undefined).join('\n');
}

export function serialise(document: Document): string {
	return document.prelude + document.blocks.map((block) => block.source + block.gap).join('');
}

/**
 * Where each Block lands in the document as it stands right now. Read at Submit,
 * after every edit, so the Agent's line numbers match the file it will re-read.
 */
export function lineRanges(document: Document): Array<[number, number]> {
	let line = newlines(document.prelude) + 1;
	return document.blocks.map((block) => {
		const start = line;
		const end = start + newlines(block.source);
		line = end + newlines(block.gap);
		return [start, end];
	});
}

/** Text the human typed into one Block, which may turn out to be several. */
function partsOf(markdown: string): Block[] {
	return parseDocument(markdown).blocks.map((block) => ({ ...block }));
}

export function replaceBlock(document: Document, index: number, markdown: string): Document {
	const parts = partsOf(markdown);
	if (parts.length === 0) return removeBlock(document, index);

	const original = document.blocks[index];
	parts[parts.length - 1].gap = original.gap;
	parts[0].id = original.id;
	parts[0].comments = original.comments;
	return {
		...document,
		blocks: [...document.blocks.slice(0, index), ...parts, ...document.blocks.slice(index + 1)]
	};
}

/** Insert after `index`; `-1` puts the new Block at the top of the document. */
export function insertAfter(document: Document, index: number, markdown: string): Document {
	const parts = partsOf(markdown);
	if (parts.length === 0) return document;

	if (index < 0) {
		parts[parts.length - 1].gap =
			document.blocks.length > 0 ? '\n\n' : document.prelude ? '' : '\n';
		return { ...document, blocks: [...parts, ...document.blocks] };
	}

	const host = document.blocks[index];
	parts[parts.length - 1].gap = host.gap;
	return {
		...document,
		blocks: [
			...document.blocks.slice(0, index),
			{ ...host, gap: '\n\n' },
			...parts,
			...document.blocks.slice(index + 1)
		]
	};
}

export function removeBlock(document: Document, index: number): Document {
	const blocks = [...document.blocks];
	const [removed] = blocks.splice(index, 1);
	// The document's trailing whitespace belongs to whichever Block now ends it.
	if (index === blocks.length && blocks.length > 0) {
		blocks[index - 1] = { ...blocks[index - 1], gap: removed.gap };
	}
	return { ...document, blocks };
}
