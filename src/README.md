# oh-my-copilot

> VSCode Copilot Chat을 terminal에서 — oh-my-openagent 스타일, `vscode.lm` 기반

GitHub Copilot Chat 모델을 터미널에서 자율 에이전트로 사용합니다.
API 키 불필요. VSCode가 열려 있으면 됩니다.

```
Terminal (oh-my-copilot CLI)
    │  HTTP (127.0.0.1)
    ▼
oh-my-copilot-bridge (VSCode Extension)
    │  vscode.lm API
    ▼
GitHub Copilot Chat (gpt-4o, gemini-2.0, and other included models)
```

---

## 설치

### 1. 브릿지 확장 설치

```bash
code --install-extension oh-my-copilot-bridge-1.0.0.vsix
```

또는 VS Code Extensions 탭에서 `oh-my-copilot-bridge` 검색 후 설치.

> VS Code가 열리면 자동으로 브릿지가 실행되어 `~/.oh-my-copilot/bridge.json`을 생성합니다.
> 상태바에 `$(plug) Copilot Bridge :PORT` 가 표시되면 정상.

### 2. CLI 설치

```bash
# 프로젝트 루트에서
npm install && npm run build && npm link

# 또는 글로벌 설치
npm install -g .
```

### 3. 진단

```bash
omc doctor           # 브릿지 연결, 모델, 설정 확인
omc doctor --verbose # 상세 정보
omc models           # 사용 가능한 Copilot 모델 목록
```

---

## 빠른 시작

```bash
omc                  # TUI 채팅 (기본 에이전트: sisyphus)
omc chat             # 동일
omc ask "what is the repository pattern?"   # 빠른 질문
omc plan "add JWT authentication"           # 실행 계획 생성
omc run "fix all TypeScript errors in src/" # 단일 작업 실행
```

---

## 에이전트 (그리스 신화)

oh-my-openagent에서 영감을 받은 에이전트 시스템입니다.
각 에이전트는 명확한 역할과 제약이 있습니다.

### Primary Agents (직접 사용)

| 에이전트 | 신화적 의미 | 역할 |
|---|---|---|
| **sisyphus** | 끝없이 바위를 굴리는 자 | 기본 오케스트레이터 — 계획·위임·실행·검증 |
| **prometheus** | 인류에게 불을 준 자 | 전략 플래너 — 인터뷰 → 실행 계획 생성 |
| **hephaestus** | 장인신 | 심층 구현 — 완전 자율 end-to-end 실행 |
| **oracle** | 신탁 | 아키텍처 분석 및 코드 리뷰 (읽기 전용) |

### Specialist Agents (primary 에이전트가 내부적으로 호출)

| 에이전트 | 역할 |
|---|---|
| **atlas** | Todo 목록 관리 — 진행 상황 추적 |
| **metis** | Scope creep 감지 — AI-slop 패턴 플래그 |
| **momus** | 계획 검증 — 실행 가능성 4가지 체크 |
| **librarian** | 문서·소스 코드 리서치 |
| **explore** | 빠른 코드베이스 탐색 |

### 에이전트 선택 가이드

```
일반 개발 작업     → sisyphus (기본)
복잡한 기능 구현   → hephaestus (깊은 자율 실행)
계획이 필요한 작업 → prometheus (인터뷰 → 계획)
코드 리뷰/분석     → oracle
빠른 질문          → oracle (ask 명령)
```

---

## Ultrawork Mode (oh-my-openagent 스타일)

ultrawork는 단순 agent 모드보다 강력한 **Oracle 검증 루프**입니다.

```
사용자 요청
    ↓
에이전트 자율 실행 (도구 사용, 루프)
    ↓
<promise>DONE</promise> 신호 감지
    ↓
Oracle이 코드베이스를 독립적으로 검토
    ↓
PASS → 완료  /  FAIL → "Oracle does not lie. Fix everything."
    ↓                        ↓
  종료              에이전트가 모든 이슈 수정
                        ↓
                   다시 DONE → Oracle 재검토
                   (최대 3회 반복)
```

**TUI에서:**
```
/ultrawork       # ultrawork 모드로 전환
/mode            # 모드 피커에서 ultrawork 선택
```

**CLI에서:**
```bash
omc ultrawork "build a REST API with auth and tests"
omc ulw "migrate the codebase to TypeScript"
```

**일반 agent vs ultrawork:**
| | agent | ultrawork |
|---|---|---|
| 자율 실행 | ✓ | ✓ |
| 셀프 검증 | 기본 | 강화 |
| Oracle 독립 검토 | ✗ | ✓ |
| "Oracle does not lie" 루프 | ✗ | ✓ (최대 3회) |
| 권장 용도 | 일반 작업 | 복잡/중요 작업 |

---

## Autonomous Agent Loop

sisyphus/hephaestus는 `agent` 모드에서 **자율 루프**를 실행합니다:

```
1. Explore   → 파일 읽기, 코드 탐색 (이해 먼저)
2. Plan      → 단계별 실행 계획 수립
3. Execute   → 도구로 실제 변경 적용
4. Verify    → 파일 읽기 확인, 테스트 실행
5. Retry     → 오류 발생 시 근본 원인 분석 후 재시도
6. Verify-2  → 완료 전 셀프 리뷰 (자동 Oracle 검증)
7. Done      → <promise>DONE</promise> 출력
```

**루프 안전장치:**
- Doom loop 감지: 동일 도구 3회 반복 호출 시 자동 중단
- Stagnation 감지: 도구 미사용 반복 시 자동 중단
- 최대 80회 반복
- `/stop` 으로 언제든 중단 가능

---

## 사용법

### 대화형 TUI

```bash
omc                                        # 기본 (sisyphus, agent 모드)
omc chat --agent prometheus                # 플래너로 시작
omc chat --model gpt-4o-mini              # 특정 모델 사용
omc chat --resume abc1234f                # 이전 세션 이어서
```

### 단일 작업 실행 (비대화형)

```bash
omc run "add TypeScript strict mode to the project"
omc run "write unit tests for auth.ts" --agent hephaestus
omc run "explain how the payment flow works" --agent oracle
```

### 실행 계획 생성

```bash
omc plan "refactor database layer to repository pattern"
# → Prometheus가 요구사항 인터뷰 후 단계별 계획 생성
```

### 빠른 질문

```bash
omc ask "what does the EventEmitter pattern do?"
omc ask "is this code thread-safe?" --model gpt-4o
```

### 복잡한 멀티스텝 작업

```bash
omc ultrawork "build a full REST API with auth, validation, and tests"
omc ulw "migrate the entire codebase from JavaScript to TypeScript"
```

---

## TUI 내 단축키

| 키 | 동작 |
|---|---|
| `Enter` | 메시지 전송 |
| `/` | 커맨드 팔레트 열기 |
| `Esc` | 팔레트/피커 닫기 |
| `Ctrl+C` | 종료 |

### 커맨드 팔레트 (`/`)

| 커맨드 | 설명 |
|---|---|
| `/agent <name>` | 에이전트 전환 |
| `/model <name>` | 모델 전환 |
| `/mode` | 모드 전환 (ask / plan / agent) |
| `/sessions` | 세션 브라우저 열기 |
| `/new` | 새 세션 시작 |
| `/stop` | 현재 생성 중단 |
| `/mcp` | MCP 서버 & 도구 보기 |
| `/shell` | 터미널 쉘 열기 |
| `/help` | 전체 도움말 |
| `/exit` | 종료 |

### 세션 브라우저 (`/sessions`)

| 키 | 동작 |
|---|---|
| `↑↓` | 탐색 |
| `Enter` | 세션 열기 (메시지 복원) |
| `/` 또는 `s` | 검색 |
| `d` | 선택한 세션 삭제 |
| `x` | 현재 제외 전체 삭제 |
| `Esc` | 닫기 |

---

## 모드

| 모드 | 설명 |
|---|---|
| **agent** | 완전 자율 — 도구 사용, 자동 루프, 셀프 검증 |
| **plan** | 분석 모드 — 읽기 전용 도구로 탐색 후 계획 제시 |
| **ask** | 빠른 답변 — 도구 없이 직접 응답 |

---

## 사용 가능한 도구 (agent 모드)

에이전트가 자율적으로 사용하는 도구들입니다:

| 도구 | 설명 |
|---|---|
| `run_terminal` | 쉘 명령 실행 (테스트, 빌드, git 등) |
| `write_file` | 새 파일 생성 또는 전체 덮어쓰기 |
| `edit_file` | 기존 파일의 특정 문자열 교체 (소규모 수정 권장) |
| `read_file` | 파일 읽기 (라인 번호 포함, 범위 지정 가능) |
| `list_files` | 디렉토리 목록 (recursive, pattern 필터 지원) |
| `search_files` | 패턴 검색 (grep, 라인 번호, context 포함) |
| `git` | git 명령 실행 (status, diff, log, blame 등) |

---

## 세션 관리

```bash
omc sessions                        # 세션 목록 (개수, 용량 표시)
omc sessions --search "auth"        # 제목/에이전트/경로로 검색
omc sessions --clean 30             # 30일 이상 된 세션 삭제
omc sessions --clean-all            # 전체 삭제
omc chat --resume abc1234f          # 세션 재개 (8자리 ID로도 가능)
```

세션은 `~/.oh-my-copilot/sessions/` 에 JSON으로 저장됩니다.
각 세션에는 제목(첫 메시지 자동 생성), 에이전트, 모델, 완료 여부가 저장됩니다.

---

## 설정 파일

프로젝트 루트에 `oh-my-copilot.jsonc` 생성 (또는 `omc install`):

```jsonc
{
  // 기본 모델
  "model": "gpt-4o",

  // 에이전트별 설정 오버라이드
  "agents": {
    "sisyphus": {
      "model": "gpt-4o",
      "temperature": 0.1
    },
    "oracle": {
      "model": "gpt-4o-mini"
    }
  },

  // MCP 서버 연결
  "mcpServers": {
    "context7": {
      "type": "stdio",
      "command": "npx @upstash/context7-mcp"
    }
  }
}
```

설정 탐색 순서: `./oh-my-copilot.jsonc` → 부모 디렉토리 → `~/.oh-my-copilot/config.jsonc`

---

## 커스텀 에이전트

마크다운 파일로 커스텀 에이전트를 만들 수 있습니다:

```markdown
---
name: reviewer
description: "코드 리뷰 전문 에이전트"
model: gpt-4o
---

You are a strict code reviewer. Focus on:
- Security vulnerabilities
- Performance issues
- Code readability

Always provide specific line numbers and actionable suggestions.
```

저장 위치 (우선순위 순):
1. `.github/agents/<name>.md` — 프로젝트 전용
2. `~/.oh-my-copilot/agents/<name>.md` — 전역

---

## 브릿지 확장 설정

VS Code 설정에서 (`Cmd+,` → "oh-my-copilot" 검색):

| 설정 | 기본값 | 설명 |
|---|---|---|
| `ohMyCopilotBridge.autoStart` | `true` | VS Code 시작 시 자동 실행 |
| `ohMyCopilotBridge.port` | `0` | 포트 (0 = 자동) |
| `ohMyCopilotBridge.defaultModel` | `gpt-4o` | 기본 모델 |

---

## 아키텍처

```
oh-my-copilot/
├── src/
│   ├── agents/          # 에이전트 정의 (prompts, factory, types)
│   ├── cli/             # CLI 커맨드 (chat, run, plan, sessions...)
│   ├── config/          # JSONC 설정 로더
│   ├── mcp/             # MCP 클라이언트
│   ├── provider/        # 브릿지 HTTP 클라이언트
│   ├── session/         # 세션 저장/관리
│   ├── tools/           # 내장 도구 (run_terminal, edit_file, git...)
│   └── ui/              # React/Ink TUI
│       ├── App.tsx
│       ├── components/  # MessageList, SessionPicker, StatusBar...
│       └── hooks/       # useChat (자율 루프 로직)
│
oh-my-copilot-bridge/
└── src/
    ├── extension.ts     # VSCode 확장 진입점
    ├── server.ts        # OpenAI 호환 HTTP 서버
    └── bridge-info.ts   # 브릿지 메타데이터 관리
```

---

## 문제 해결

**브릿지를 찾을 수 없음**
```bash
omc doctor
# → VS Code가 열려 있는지, 브릿지 확장이 설치되었는지 확인
# → 상태바에 "Copilot Bridge" 표시 여부 확인
```

**모델이 없음**
```bash
omc models
# → GitHub Copilot이 활성화되어 있는지 확인
# →  VS Code에서 Copilot Chat이 동작하는지 먼저 테스트
```

**타임아웃**
- 스트림 타임아웃: 60초 (복잡한 작업은 /stop 후 재시도)
- 브릿지 재시작: VS Code 커맨드 팔레트 → "Oh My Copilot Bridge: Start"

---

## 요구 사항

- VS Code 1.90+
- GitHub Copilot (Business 또는 Enterprise 권장)
- Node.js 18+

---

## 라이센스

MIT
