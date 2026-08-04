import rehypeSanitize from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';

/** Only the parts of the rendered tree this file reads. */
type Rendered = {
	type: string;
	tagName?: string;
	properties?: Record<string, unknown>;
	children?: Rendered[];
};

/**
 * A stand-in for the Project Root, which the daemon serves from `/`. Resolving
 * against it says whether an address in the document names a file in the
 * project or somewhere else entirely.
 */
const PROJECT_ROOT = 'mdvl://root/';

/**
 * Where the document being rendered sits, so a relative address in it can be
 * read the way the person who wrote it meant. Every render runs to completion
 * before the next one starts, so one pipeline can be told this each time
 * instead of being rebuilt per document.
 */
let documentBase = new URL(PROJECT_ROOT);

/**
 * A relative `src` is relative to the document, but the page it is drawn on is
 * `/v` or `/r/<id>` — neither is where the document lives, and `/r/<id>` is a
 * segment deeper besides. Each one is resolved against the document's own
 * directory and handed to the browser as an address under the Project Root.
 */
function rebase(src: string, base: URL): string {
	let resolved: URL;
	try {
		resolved = new URL(src, base);
	} catch {
		return src;
	}
	// An absolute or protocol-relative address names another machine. The daemon
	// is bound to loopback and is not a proxy, so those are left for the browser.
	if (resolved.protocol !== base.protocol || resolved.host !== base.host) return src;
	return resolved.pathname + resolved.search + resolved.hash;
}

function retargetPictures(node: Rendered, base: URL) {
	const { properties } = node;
	if (node.type === 'element' && node.tagName === 'img' && typeof properties?.src === 'string') {
		properties.src = rebase(properties.src, base);
	}
	for (const child of node.children ?? []) retargetPictures(child, base);
}

/**
 * The file being reviewed was written by an Agent, which may have been reading
 * from the open web — its markdown is not trusted, so raw HTML never survives
 * into the page. Addresses are rewritten after sanitising, so nothing the
 * sanitiser dropped can come back as a path the daemon is then asked for.
 */
const renderer = unified()
	.use(remarkParse)
	.use(remarkGfm)
	.use(remarkRehype)
	.use(rehypeSanitize)
	.use(() => (tree: Rendered) => retargetPictures(tree, documentBase))
	.use(rehypeStringify);

export function renderMarkdown(source: string, definitionSource = '', documentPath = ''): string {
	documentBase = new URL(documentPath, PROJECT_ROOT);
	const markdown = definitionSource ? `${source}\n\n${definitionSource}` : source;
	return String(renderer.processSync(markdown));
}
