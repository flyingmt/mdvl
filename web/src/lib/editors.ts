/**
 * How every small editor in the review behaves, written once so the three of
 * them cannot drift apart.
 */

/** Escape backs out, ⌘/Ctrl+Enter accepts. */
export function editorKeys(accept: () => void, abandon: () => void) {
	return (event: KeyboardEvent) => {
		if (event.key === 'Escape') abandon();
		if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) accept();
	};
}

/** Move focus into an editor the reviewer just chose to open. */
export function takeFocus(element: HTMLElement) {
	element.focus();
}
