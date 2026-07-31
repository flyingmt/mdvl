---
name: mdvl-seams
description: mdvl에 테스트를 쓰거나 고칠 때 반드시 사용할 것. 두 심(심 A - tests/cli.rs의 Rust CLI 통합, 심 B - web/e2e의 Playwright)의 위치·실행법·함정과, 새 테스트가 수정 없이는 실제로 실패하는지 증명하는 절차를 담는다. "테스트 추가", "회귀 테스트", "이거 어떻게 검증하나", "테스트가 통과하는데 이상하다", "e2e", "playwright", "cargo test" 요청 시 트리거.
---

# mdvl-seams

이 프로젝트의 테스트는 두 곳에서만 붙는다. 스펙이 그렇게 결정했고, 심을 늘리는
것은 결정을 뒤집는 일이다.

| 심 | 파일 | 지키는 계약 | 실행 |
|---|---|---|---|
| **A** | `tests/cli.rs`, `tests/harness/mod.rs` | 에이전트가 받는 것 — JSON, 디스크 바이트, 종료 코드 | 루트에서 `cargo test` |
| **B** | `web/e2e/review.spec.ts`, `web/e2e/mdvl.ts` | 사람이 보는 것 — 실제 데몬 + 실제 브라우저 | `web/`에서 `npx playwright test` |

## 테스트가 무는지 증명한다

새 테스트가 통과하는 것으로 끝내면 안 된다. **수정을 되돌렸을 때 실패해야**
그 테스트가 무언가를 지키는 것이다.

이 규율이 여기 있는 이유는 실제 사고 때문이다. 탭을 닫으면 마지막 편집이
사라지는 버그를 고치고 테스트를 붙였다. 테스트는 합성 `pagehide` 이벤트를
살아있는 문서에 쏘고 `reload()` 했다 — 문서가 언로드되지 않으니 수정이 있든
없든 통과했다. 버그는 살아있는데 "고쳤다"고 보고됐고, 두 번째 리뷰가 잡았다.

```
1. 테스트를 쓴다
2. 수정을 임시로 되돌린다 — 플래그 뒤집기, 한 줄 주석, git stash
3. 그 테스트만 돌린다
     cargo test <이름>
     npx playwright test -g "<이름 일부>"
4. 실패해야 한다
5. 수정을 복원하고 다시 돌린다
```

**실패시키지 못했으면 지우지 말고 한계를 적는다.** 정당한 경우가 있다 —
루프백에서는 평범한 `fetch`도 대개 언로드 전에 데몬에 닿아서, `keepalive`
없이도 통과한다. 그럴 때 테스트는 여전히 값이 있다("탭을 닫아도 작업이
사라지지 않는다"). 다만 주석에 무엇을 증명하지 못하는지 쓴다:

```ts
// Closed for real, not a synthetic `pagehide` on a document that stays alive.
// Over loopback a plain fetch usually reaches the daemon before the page is
// torn down, so this cannot prove `keepalive` is what saved the work — only
// that closing the tab does not cost it.
```

거짓 통과보다 적힌 한계가 낫다.

## 좋은 테스트

**외부에서 관찰 가능한 것만.** 어떤 함수가 불렸는지가 아니라 결과. 심 A는
`mdvl wait`가 찍는 JSON과 디스크의 바이트를 본다. 심 B는 리뷰어가 화면에서
보는 것을 본다.

**이름이 문장이다.** `a_file_changed_on_disk_blocks_the_write_and_keeps_the_humans_version`
— 실패 출력만 보고 무엇이 깨졌는지 안다.

**assert에 이유를 단다.**

```rust
assert_eq!(
    h.read("plan.mdvl-conflict.md"),
    "# Plan\n\nAuth uses sessions.\n",
    "the human's work must survive the conflict"
);
```

다음 사람이 이 assert를 지워도 되는지 판단할 수 있다.

**보안 경계는 예외 없이 회귀 테스트를 갖는다.** 경로 탈출(평범한 경로 · `..` ·
심볼릭 링크), 토큰 부재·오류, 외부 Origin, 쿼리 토큰의 라우트 제한, 충돌 시
쓰기 거부, `daemon.json` 권한. 토큰 유출 수정이 회귀 테스트 없이 커밋된 적이
있다.

## 심 A 쓰는 법

`Harness`가 임시 Project Root(`.git` 포함)와 문서 하나, 그리고 데몬을 세운다.
`Drop`에서 데몬을 죽이므로 새 테스트도 반드시 `Harness`를 쓴다 — 안 그러면
데몬이 남는다.

```rust
let (h, id) = Harness::with_doc("plan.md", DOC);
h.submit(&id, "새 내용", json!([...]), "전체 코멘트");
let (result, code) = h.wait(&id, 5);
```

- `h.ticket` — 브라우저가 URL에 실어갔을 1회용 티켓
- `h.review_expecting_refusal(path)` — 거부돼야 하는 경로. stderr를 돌려준다
- `status_of(...)` / `status_of_json(...)` — 4xx가 예상되는 요청의 상태 코드

주의: 통합 테스트는 `[dev-dependencies]`만 본다. 바이너리 크레이트의
`[dependencies]`에 있는 것은 dev에도 넣어야 쓸 수 있다.

## 심 B 쓰는 법

`web/e2e/mdvl.ts`가 데몬을 세우고 브라우저가 열었을 URL(티켓 포함)을 돌려준다.

```ts
const review = openReview(DOC);
await page.goto(review.url);
```

`test.afterEach(stopEverything)`가 데몬을 정리한다.

### 심 B 함정

- **반드시 `web/`에서 실행한다.** 루트에서 돌리면 playwright를 새로 설치하고
  설정을 못 찾아 무관한 에러를 낸다.
- **먼저 `npm run build`.** 데몬이 `web/build`를 런타임에 읽는다. 안 하면 지난
  자산을 검증한다. `mdvl-gate`가 이 순서를 강제한다.
- **로케일 고정.** 설정이 `en-US`다. 한국어는 `test.use({ locale: 'ko-KR' })`로
  자기 `describe` 안에서만.
- **역할·라벨로 잡는다.** `getByRole('button', { name: 'Submit' })`이 접근성까지
  같이 검증한다. testid는 `block`, `insertion-point`, `diagram` 셋뿐.
- **셀렉터가 조용히 넓어진다.** Lucide 아이콘이 들어오자 `locator('svg')`가 4개를
  물었고, Dialog가 생기자 같은 라벨 버튼이 둘이 됐다. 좁힌다:
  `page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true })`
- **`exact: true`를 잊지 않는다.** `{ name: 'Insert' }`는 `'Insert a block here'`도
  문다.

## 커버리지 판단

스펙(issue #1)의 Testing Decisions가 심 A 8건, 심 B 9건을 명시한다. 새 동작을
넣었으면 그 목록에 항목이 하나 늘어야 한다. 늘지 않는다면 둘 중 하나다 —
관찰 가능한 동작이 아니거나, 테스트를 빠뜨렸거나.

## 협업

`tdd` 스킬이 red-green 루프 자체를 규정한다. 이 스킬은 **이 프로젝트에서 심이
어디고, 어떻게 돌리고, 무엇이 함정인지**를 더한다.
