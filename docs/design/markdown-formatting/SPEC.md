# 시안 스펙 — 브라우저에서 읽는 마크다운 포맷팅

> 시안 라운드에 배포된 브리프다. 아래의 "현행"은 **시안 적용 전**의 `app.css`를
> 가리킨다 — 시안 A가 채택돼 적용된 뒤의 코드가 아니다.

세 개의 시안이 공유하는 **단 하나의 입력**. 시안 작성자는 이 파일과
`sample-blocks.html`만 보고 작업한다. 다른 시안은 보지 않는다.

## 무엇을 만드는가

mdvl의 렌더된 마크다운(`.rendered`)이 브라우저에서 더 잘 읽히도록 만드는 **CSS 시안 1종**과,
그 CSS가 실제 문서에 적용된 모습을 보여주는 **자체 완결 HTML 데모 1개**.

## 제품 맥락

mdvl은 코딩 에이전트가 사람에게 마크다운 파일을 넘기고 판단을 돌려받는 도구다.
사람이 브라우저에서 보는 화면은 두 가지고, 둘 다 같은 렌더링을 쓴다.

- **View** (`mdvl view`) — 읽기 전용. 순수하게 읽는 화면. 이번 시안의 주 무대.
- **Review** (`mdvl review`) — 같은 렌더링 + 블록별 편집/코멘트 컨트롤.

읽는 사람은 **글을 판단하러** 온 것이다. 화면이 글과 경쟁하면 실패다.
현행 `app.css` 주석이 그 의도를 못박아 뒀다: "Deliberately plain: the reviewer is here
to judge the writing, so nothing should compete with it."

## 목표 (사용자가 지목한 불편 3가지)

1. **위계가 안 보인다** — h1/h2/h3 구분이 약해 긴 문서에서 구조를 잃는다.
2. **코드·표 가독성** — 코드 펜스에 신택스 하이라이팅이 없고, 표는 밀도/정렬이 거칠다.
3. **밀도·여백** — 줄간격·블록 간격·본문 폭이 읽기에 안 맞는다.

### 진단된 근본 원인 (반드시 고칠 것)

현행 `app.css`의 이 두 줄이 모든 블록의 바깥 여백을 죽인다.

```css
.rendered > :first-child { margin-top: 0; }
.rendered > :last-child  { margin-bottom: 0; }
```

각 Block은 **자기만의 `div.rendered`** 안에 렌더되고, 대개 자식 요소가 하나뿐이다.
그래서 그 요소는 첫째이자 막내 → 위아래 여백이 전부 0이 된다. 특이도도
`.rendered > :first-child`(0,2,0)가 `.block-heading h1`(0,1,1)을 이겨서
`margin-top: 0.5em` 같은 규칙은 애초에 적용된 적이 없다.

결과: **View 화면에서 블록들이 간격 0으로 맞붙어 있다.** Review 화면만
`InsertionPoint`의 `h-5`(1.25rem) 덕에 우연히 간격이 생긴다.
→ 블록 간 수직 리듬은 시안이 **명시적으로** 설계해야 한다.

## 범위 (사용자가 확정)

**렌더링 포맷팅만.** 헤더·버튼·사이드바 같은 앱 chrome은 건드리지 않는다.

- 건드려도 되는 것: `.rendered`, `.block-heading`, `.block-paragraph`, `.block-list`,
  `.block-quote`, `.block-table`, `.block-code`, `.block-mermaid`, 본문 폭, 타이포 토큰
- 건드리면 안 되는 것: 페이지 헤더, 편집/코멘트 버튼, 다이얼로그, 라우팅, 마크다운 파서
- TOC·진행바 같은 **새 UI 요소는 추가하지 않는다** (범위 밖)

## 실제 DOM (반드시 이 구조 위에서 설계할 것)

한 Block = `div` 하나. 블록끼리는 **형제 선택자가 통하지 않는다** (각자 다른 `.rendered` 컨테이너).
따라서 `h2 + p { margin-top: 0 }` 류의 고전적 수직 리듬 기법을 쓸 수 없다.

```html
<main class="mx-auto w-full max-w-[46rem] px-4 py-8">
  <div class="group relative" data-testid="block">
    <div class="rendered block-heading"><h2>Language</h2></div>
  </div>
  <div class="group relative" data-testid="block">
    <div class="rendered block-paragraph"><p>…</p></div>
  </div>
  <div class="group relative" data-testid="block">
    <div class="block-code relative">
      <span class="lang-badge">bash</span>
      <pre><code>…</code></pre>
    </div>
    <!-- 코멘트가 달린 블록 -->
    <ul class="comment-rail"><li>…</li></ul>
  </div>
</main>
```

- 코드 펜스만 `.rendered`를 거치지 않는다 (원문 보존을 위해 파서를 우회). 현행 스타일은
  컴포넌트의 Tailwind 유틸리티(`rounded-lg bg-muted p-3.5 font-mono text-[0.8125rem]`)에 박혀 있다.
  시안이 코드 블록을 바꾸려면 `CodeFence.svelte`의 클래스 교체가 필요하다 — **바꿔도 되지만
  데모 하단 노트에 "컴포넌트 수정 필요"라고 명시**할 것.
- 코멘트 레일(amber 좌측 보더)은 렌더 영역 바로 아래 붙는다. 시안의 여백 체계가 이걸
  깨뜨리지 않아야 하므로, 데모에 코멘트 달린 블록을 **최소 1개** 보여줄 것.

## 기술 제약

- **자체 완결 HTML 1개 파일.** 외부 CDN·웹폰트·JS 라이브러리 금지 (`file://`로 열려야 함).
- 폰트는 **시스템 스택만** 사용 (`ui-sans-serif`, `ui-serif`, `ui-monospace`, `system-ui`,
  `-apple-system`, `Georgia`, `Menlo` 등). 실제 앱은 **Pretendard Variable**을 쓴다 —
  본문 폰트를 바꾸자고 제안하려면 **한글이 깨지지 않는지** 데모의 한국어 문단으로 직접 확인하고,
  하단 노트에 "프로덕션 폰트: X, 한글 대체: Y"를 적을 것.
- **라이트/다크 둘 다** 동작해야 한다. 데모 상단에 토글 버튼 하나 (인라인 JS 몇 줄은 허용).
- 색은 아래 shadcn 토큰 체계 안에서. 새 색을 만들려면 `oklch()`로 쓰고 왜 필요한지 노트에 적을 것.
- 접근성 하한: 본문 ≥ 15px, 부가 텍스트 ≥ 12px, 본문 대비 ≥ 4.5:1 (라이트·다크 모두).

### 현행 토큰 (라이트 / 다크)

```
--background   oklch(1 0 0)        / oklch(0.145 0 0)
--foreground   oklch(0.145 0 0)    / oklch(0.985 0 0)
--muted        oklch(0.97 0 0)     / oklch(0.269 0 0)
--muted-fg     oklch(0.556 0 0)    / oklch(0.708 0 0)
--border       oklch(0.922 0 0)    / oklch(1 0 0 / 10%)
--radius       0.625rem
```

현행 값: 본문 `17px`/`line-height 1.7`, 본문 폭 `46rem`, h1 `28px`, h2 `22px`, h3 `18px`.
전부 바꿔도 된다 — 바꿨으면 왜 그 값인지 노트에 한 줄.

## 산출물

1. `docs/design/markdown-formatting/<슬러그>.html`
   - 상단: 시안 이름 + **한 줄 근거** + 라이트/다크 토글
   - 본문: `sample-blocks.html`의 블록 **전부**를, 순서 그대로, 실제 DOM 구조로
   - `<style>` 안에 `/* === app.css 교체분 시작 === */ … /* === 끝 === */` 주석으로
     실제 앱에 그대로 옮길 구간을 감쌀 것. **이 구간이 진짜 산출물이다.**
   - 하단 노트 (5줄 이내): 무엇을 바꿨나 / 프로덕션 폰트 / 컴포넌트 수정 필요 여부 /
     **이 form이 이 문서 내용의 어디서 나왔는지 한 줄**
2. 스크린샷 2장: `shots/<슬러그>-light.png`, `shots/<슬러그>-dark.png`
   - `npx playwright screenshot --full-page --viewport-size=1280,900`

## 시안 사이의 규칙

- 세 시안은 **같은 내용**을 렌더한다. 다른 건 포맷팅뿐이다.
- 세 시안의 **골격이 서로 달라야 한다.** 색만 바꾼 껍데기 교체는 실패.
  최소한 다음 중 **둘 이상**이 구조적으로 달라야 한다:
  위계 신호 방식 / 수직 리듬 체계 / 본문 폭·측정 / 코드 블록 형태 / 표 형태 / 본문 서체 분류
- **AI slop 금지**: 보라 그라디언트, 이모지 아이콘, 장식용 아이콘, 이유 없는 좌측 컬러 보더 카드,
  균일한 딥네이비 + 네온 글로우. 장식이 아니라 **읽기**를 위한 결정만 남길 것.
- 내용을 지어내지 말 것. 샘플에 없는 텍스트/숫자/배지를 추가하지 않는다.
