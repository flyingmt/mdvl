/**
 * Every small editor in the review behaves the same way: Escape backs out,
 * ⌘/Ctrl+Enter accepts. Written once so they cannot drift apart.
 */
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
