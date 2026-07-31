/**
 * The reviewer reads in whatever language their browser is set to. The English
 * dictionary is the source of truth — every other one is typed against it, so a
 * missing or stale key fails the build rather than the reviewer.
 */
const en = {
	stopApp: 'Stop app',
	stoppedApp: 'mdvl has stopped. You can close this tab.',
	loading: 'Loading…',

	sentTitle: 'Sent to the agent.',
	sentBody: 'Your edits are saved. You can go back to the agent now.',
	endedTitle: 'Review ended.',
	endedBody: 'Nothing was written to the file.',
	conflictTitle: 'The file changed while you were reviewing.',
	conflictBefore: 'Nothing was overwritten. Your version was kept at',
	conflictAfter: '— the agent has been told where to find it.',

	overallLabel: 'Anything about the document as a whole?',
	overallPlaceholder: 'Optional — e.g. too long, wrong audience, missing a section',
	submit: 'Submit',
	endReview: 'End review',
	endReviewTitle: 'End without sending anything?',
	endReviewBody: 'Your edits and comments are discarded, and the file is left as it is.',
	keepReviewing: 'Keep reviewing',
	commentCount: (many: number) => `${many} ${many === 1 ? 'comment' : 'comments'}`,

	editBlock: 'Edit this block',
	commentOnBlock: 'Comment on this block',
	deleteBlock: 'Delete this block',
	blockSource: 'Markdown source of this block',
	done: 'Done',
	cancel: 'Cancel',
	editorHint: '⌘↵ to finish · Esc to discard',
	deleteWithComments: (many: number) =>
		`Delete this block and its ${many} ${many === 1 ? 'comment' : 'comments'}?`,
	deleteAnyway: 'Delete',
	keepBlock: 'Keep',

	newCommentLabel: 'New comment on this block',
	newCommentPlaceholder: 'What should the agent do here?',
	addComment: 'Add comment',
	removeComment: 'Remove this comment',

	insertHere: 'Insert a block here',
	newBlockLabel: 'Markdown for the new block',
	newBlockPlaceholder: 'New block…',
	insert: 'Insert',

	diagramFailed: 'This diagram could not be drawn.',

	nothingTitle: 'Nothing to review',
	nothingBody:
		'This tab opens when an agent hands you a markdown file. Ask yours to start a review — it runs'
} as const;

/** Same keys, same argument shapes — but any wording. */
type Dictionary = {
	[K in keyof typeof en]: (typeof en)[K] extends (...args: infer Args) => infer Result
		? (...args: Args) => Result
		: string;
};

const ko: Dictionary = {
	stopApp: '앱 종료',
	stoppedApp: 'mdvl이 종료됐습니다. 이 탭을 닫아도 됩니다.',
	loading: '불러오는 중…',

	sentTitle: '에이전트에게 보냈습니다.',
	sentBody: '편집한 내용은 저장됐습니다. 이제 에이전트로 돌아가세요.',
	endedTitle: '리뷰를 끝냈습니다.',
	endedBody: '파일에는 아무것도 쓰지 않았습니다.',
	conflictTitle: '리뷰하는 동안 파일이 바뀌었습니다.',
	conflictBefore: '아무것도 덮어쓰지 않았습니다. 작업하신 내용은 여기에 남겼습니다:',
	conflictAfter: '— 에이전트에게 이 위치를 알렸습니다.',

	overallLabel: '문서 전체에 대해 하고 싶은 말이 있나요?',
	overallPlaceholder: '선택 사항 — 예: 너무 길다, 대상 독자가 틀렸다, 빠진 장이 있다',
	submit: '제출',
	endReview: '리뷰 종료',
	endReviewTitle: '아무것도 보내지 않고 끝낼까요?',
	endReviewBody: '편집한 내용과 코멘트가 버려지고, 파일은 그대로 남습니다.',
	keepReviewing: '계속 보기',
	commentCount: (many: number) => `코멘트 ${many}개`,

	editBlock: '이 블록 수정',
	commentOnBlock: '이 블록에 코멘트',
	deleteBlock: '이 블록 삭제',
	blockSource: '이 블록의 마크다운 원문',
	done: '완료',
	cancel: '취소',
	editorHint: '⌘↵ 완료 · Esc 취소',
	deleteWithComments: (many: number) => `이 블록과 코멘트 ${many}개를 삭제할까요?`,
	deleteAnyway: '삭제',
	keepBlock: '유지',

	newCommentLabel: '이 블록에 남길 새 코멘트',
	newCommentPlaceholder: '에이전트가 여기서 뭘 해야 하나요?',
	addComment: '코멘트 추가',
	removeComment: '이 코멘트 삭제',

	insertHere: '여기에 블록 삽입',
	newBlockLabel: '새 블록의 마크다운',
	newBlockPlaceholder: '새 블록…',
	insert: '삽입',

	diagramFailed: '이 다이어그램을 그릴 수 없습니다.',

	nothingTitle: '리뷰할 것이 없습니다',
	nothingBody:
		'에이전트가 마크다운 파일을 건네면 이 탭이 열립니다. 에이전트에게 리뷰를 시작해 달라고 하세요 — 다음을 실행합니다:'
};

const dictionaries: Record<string, Dictionary> = { en, ko };

function spoken(): Dictionary {
	if (typeof navigator === 'undefined') return en;
	for (const tag of navigator.languages ?? [navigator.language]) {
		const dictionary = dictionaries[tag.split('-')[0]];
		if (dictionary) return dictionary;
	}
	return en;
}

export const t: Dictionary = spoken();
