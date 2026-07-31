---
name: mdvl-build
description: mdvl에 기능을 더하거나 동작을 바꾸거나 버그를 고칠 때 반드시 사용할 것. contract-keeper·implementer·seam-tester·verifier 4명 팀으로 계약 확인 → 실패하는 테스트 → 구현 → 게이트를 돌린다. "기능 추가", "고쳐줘", "구현해줘", "버그", "동작 바꿔", "리팩터", "다시 실행", "재실행", "업데이트", "보완", "이전 결과 기반으로", "{부분}만 다시" 요청 시 트리거. 오타 수정이나 단순 질문에는 쓰지 않는다.
---

# mdvl-build

mdvl에 코드 변경을 넣는 워크플로우. 실행 모드는 **에이전트 팀**이다.

팀을 쓰는 이유는 이 프로젝트에서 실제로 뚫린 구멍들이 전부 **경계면**에서
났기 때문이다. 테스트를 쓴 사람과 구현한 사람이 같으면 테스트가 구현을
검증하는지 아무도 안 본다. 문서를 갱신한 사람과 코드를 쓴 사람이 같으면 둘이
모순된 채 커밋된다. 팀원들이 서로에게 물어야 그 경계가 검사된다.

## Phase 0: 컨텍스트 확인

무엇을 하려는지 결정하기 전에 지금 어디인지 본다.

```bash
ls _workspace/ 2>/dev/null && git status --short
```

| 상황 | 모드 |
|---|---|
| `_workspace/` 없음 | **초기 실행** — Phase 1부터 |
| `_workspace/` 있음 + 사용자가 특정 부분 수정 요청 | **부분 재실행** — 해당 에이전트만 재호출, 나머지 산출물 유지 |
| `_workspace/` 있음 + 새 작업 | **새 실행** — `_workspace/`를 `_workspace_prev/`로 옮기고 처음부터 |

작업 트리가 깨끗하지 않으면 먼저 사용자에게 알린다. 남의 미완성 변경 위에
쌓지 않는다.

## Phase 1: 계약 확정 (팀 구성 전)

`contract-keeper`를 **단독으로** 먼저 호출한다. 계약이 정해지기 전에는 구현자도
테스터도 할 일이 없고, 이 단계 결과가 나머지 전원의 입력이기 때문이다.

```
Agent(subagent_type="general-purpose", model="opus",
      prompt=".claude/agents/contract-keeper.md를 읽고 그 역할로 행동하라.
              작업: {사용자 요청}
              mdvl-contracts 스킬을 참조하라.
              산출물: _workspace/01_contract.md")
```

결과에 **재론 위험**이 있으면(`.out-of-scope/`에 이미 있는 항목) 진행하기 전에
사용자에게 올린다. 이미 논파된 걸 다시 만드는 것은 이 하네스가 막아야 할 일이다.

## Phase 2: 팀 실행

`TeamCreate`로 3명 팀을 만든다. contract-keeper는 계약을 넘겼으므로 팀에는
질문받는 역할로만 참여한다 — 팀원 4명이 아니라 3명 + 자문 1명으로 두면 조율
비용이 준다.

| 팀원 | 작업 | 참조 스킬 |
|---|---|---|
| `seam-tester` | 실패하는 테스트를 먼저 쓴다 | `mdvl-seams` |
| `implementer` | 테스트를 통과시킨다 | — |
| `contract-keeper` | 이탈을 즉시 지적하고, 끝나면 문서를 갱신한다 | `mdvl-contracts` |

각 팀원 프롬프트에 `.claude/agents/{이름}.md`를 읽으라는 지시와 참조 스킬을
명시한다.

`TaskCreate`로 의존 관계를 건다:

```
1. [seam-tester]      새 동작의 테스트를 쓰고 실패를 확인한다
2. [implementer]      1에 의존 — 테스트를 통과시킨다
3. [seam-tester]      2에 의존 — 수정을 되돌려 테스트가 실패하는지 증명한다
4. [contract-keeper]  2에 의존 — 문서를 코드와 맞춘다
```

**3번을 빼지 않는다.** 이 하네스가 존재하는 이유의 절반이 거기 있다.

팀원들은 `SendMessage`로 직접 조율한다. 리더(너)는 진행을 보고 결과를 모은다.

모든 `Agent` 호출에 `model: "opus"`를 명시한다.

## Phase 3: 검증

팀을 정리하고 `verifier`를 **단독으로** 호출한다. 검증자가 팀 안에 있으면
팀의 맥락에 물든다 — 독립성이 이 역할의 전부다.

```
Agent(subagent_type="general-purpose", model="opus",
      prompt=".claude/agents/verifier.md를 읽고 그 역할로 행동하라.
              mdvl-gate 스킬로 게이트를 돌려라.
              _workspace/의 01~04를 읽고 주장된 수정이 실제로 고쳤는지 확인하라.
              산출물: _workspace/05_verification.md")
```

게이트가 실패하면 실패한 항목을 담당 팀원에게 돌린다. **통과했다고 말하지
않는다.**

## Phase 4: 보고와 피드백

사용자에게 보고한다:

- 무엇을 바꿨나 (`02_changes.md`)
- 어떤 테스트가 지키나, **그리고 되돌림으로 증명됐나** (`03_seams.md`)
- 어떤 문서가 갱신됐나 (`04_contract_sync.md`)
- 게이트 결과와 **검증하지 못한 것** (`05_verification.md`)

증명하지 못한 테스트와 검증하지 못한 것을 **빼놓지 않는다.** 그게 이 워크플로우가
만드는 값이다.

그 다음 물어본다:
- "결과에서 개선할 부분이 있나요?"
- "팀 구성이나 순서에 바꾸고 싶은 점이 있나요?"

큰 변경이면 `code-review` 스킬로 두 축 리뷰를 이어 돌리자고 제안한다.

## 데이터 전달

- **태스크 기반** — `TaskCreate`/`TaskUpdate`로 의존과 진행
- **파일 기반** — `_workspace/{순번}_{에이전트}_{산출물}.md`. 중간 파일은 지우지
  않는다 (사후 검증용)
- **메시지 기반** — `SendMessage`로 실시간 질문·지적

| 파일 | 누가 쓰나 |
|---|---|
| `_workspace/01_contract.md` | contract-keeper (Phase 1) |
| `_workspace/02_changes.md` | implementer |
| `_workspace/03_seams.md` | seam-tester |
| `_workspace/04_contract_sync.md` | contract-keeper (Phase 2) |
| `_workspace/05_verification.md` | verifier |

## 에러 핸들링

| 상황 | 대응 |
|---|---|
| 에이전트 실패 | 1회 재시도. 재실패하면 그 산출물 없이 진행하고 **보고서에 누락을 명시** |
| 계약과 테스트가 충돌 | 임의로 한쪽을 따르지 않는다. 양쪽 인용해 사용자에게 |
| 게이트 실패 | 담당에게 반려. 통과할 때까지 완료 선언 금지 |
| 심 B 간헐 실패 | 재시도로 덮지 않는다. 간헐적이라는 사실을 보고 |
| 되돌림 증명 불가 | 건너뛰지 말고 이유와 함께 보고. 테스트 주석에 한계를 적는다 |

상충하는 데이터는 지우지 않는다 — 출처를 병기한다.

## 언제 이 워크플로우를 쓰지 않나

- 오타 수정, 주석 한 줄 — 직접 고친다
- "이거 어떻게 동작하나" — 직접 답한다
- 문서만 고치는 작업 — `contract-keeper` 단독이면 충분
- 테스트만 추가 — `seam-tester` 단독 + `mdvl-gate`

3단계 팀은 조율 비용이 있다. 그 비용을 낼 만한 변경에만 쓴다.

## 테스트 시나리오

**정상 흐름** — "리뷰 화면에 코멘트 개수 뱃지를 추가해줘"

1. Phase 0: `_workspace/` 없음 → 초기 실행
2. Phase 1: contract-keeper가 `docs/design/reviewer-app.md`(푸터에 코멘트 수가
   이미 있음)와 `.out-of-scope/`(관련 없음)를 확인, "이미 존재함"을 보고 →
   사용자에게 확인 후 중단 또는 범위 재정의
3. 범위가 바뀌면 Phase 2로

**에러 흐름** — "다크모드 토글 넣어줘"

1. Phase 1: contract-keeper가 `.out-of-scope/dark-mode.md`를 찾음
2. 재론 조건("리뷰어가 그 시간대에 라이트 화면이 실제로 읽기 힘들다고 말할 때")이
   충족됐는지 사용자에게 확인
3. 충족 안 되면 그 파일의 논거를 인용해 보고하고 **팀을 만들지 않는다**
4. 충족되면 out-of-scope 파일을 지우고 ADR로 전환한 뒤 Phase 2

**게이트 실패 흐름**

1. Phase 3에서 `rust · clippy` 실패
2. verifier가 실패 항목을 implementer에게 반려
3. 수정 후 게이트 재실행
4. 통과할 때까지 Phase 4로 넘어가지 않는다
