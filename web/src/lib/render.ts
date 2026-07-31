import rehypeSanitize from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';

/**
 * The file being reviewed was written by an Agent, which may have been reading
 * from the open web — its markdown is not trusted, so raw HTML never survives
 * into the page.
 */
const renderer = unified()
	.use(remarkParse)
	.use(remarkGfm)
	.use(remarkRehype)
	.use(rehypeSanitize)
	.use(rehypeStringify);

export function renderMarkdown(source: string): string {
	return String(renderer.processSync(source));
}
