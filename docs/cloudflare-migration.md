# Cloudflare 이전 단계

## 현재 완료된 단계: 서버 구현·로컬 검증·공개 서버 배포

기존 화면·싱글플레이·공통 채점 규칙을 유지하며 Cloudflare 서버를 추가했습니다. 공개 서버는 `https://type-battle-server.ddayul.workers.dev`이며, 해당 주소에서도 두 플레이어 통합 테스트를 통과했습니다. `.env.production`과 Pages 워크플로의 기본 연결 주소를 반영했으므로 코드가 main에 반영되면 공개 게임도 새 서버로 전환됩니다. 기본 `npm run dev`는 이전 Nakama 개발 연결을 유지합니다.

- `worker/index.js`: HTTP 방 생성·조회, 게스트 인증, 허용 출처 확인, WebSocket 연결 전달.
- `worker/room.js`: 방별 SQLite Durable Object, WebSocket Hibernation, 상태 저장·복구, 카운트다운·종료 알람, 빈 방 정리.
- `worker/game.js`: 준비·설정·방장 권한·채점·재경기와 결과 확정.
- `src/multiplayer.js`: Cloudflare 또는 기존 Nakama를 선택하는 통신 모듈.
- `shared/protocol.js`: 메시지 번호와 프로토콜 버전.

키 입력은 WebSocket attachment에 보관하고, 설정 변경·입퇴장·경기 단계 변경은 Durable Object 저장소에 기록합니다. 매 프레임 실행하는 서버 루프는 없습니다. 일시 정지 후 재생성될 때 저장소와 attachment를 합쳐 복구합니다. Hibernation은 지원하지만, 브라우저 연결이 끊긴 뒤 진행 중인 경기에 재입장하는 기능은 아직 없습니다.

## 1. 로컬 실행 (계정·카드·Docker 불필요)

Node.js 22.12 이상을 사용합니다. 터미널 두 개를 열고 프로젝트 폴더에서 실행하세요.

```powershell
# 터미널 1: 로컬 Cloudflare 서버
npm.cmd ci
npm.cmd run worker:dev
```

```powershell
# 터미널 2: Cloudflare 연결 모드 게임 화면
npm.cmd run dev:cloudflare
```

`http://127.0.0.1:5173`을 두 탭에서 열어 방 생성 → 참가 → 준비 → 시작 순서로 확인합니다. Vite가 다른 포트를 제안하면 기존 서버를 종료하거나 `worker/wrangler.jsonc`의 `ALLOWED_ORIGINS`에 실제 출처를 추가하세요. `.env.local`에 같은 변수가 있으면 `.env.cloudflare`보다 우선하므로 확인하세요.

```powershell
npm.cmd test
npm.cmd run build
npm.cmd run worker:check
# worker:dev가 실행 중인 상태에서 두 플레이어 통합 테스트
npm.cmd run test:cloudflare
```

`worker:check`는 실제 업로드 없이 빌드만 확인합니다. `test:cloudflare`는 기본적으로 로컬 서버에서만 임시 방을 만듭니다.

## 2. 사용자가 할 일: Cloudflare 계정 준비

1. Cloudflare 무료 계정 가입 및 이메일 인증.
2. Workers 무료 플랜 사용. 유료 플랜·Containers·R2 활성화는 이 구성에 필요하지 않습니다.
3. 프로젝트 폴더에서 `npm.cmd run worker:login`을 실행하고 브라우저에서 로그인·권한 승인.

로그인 비밀번호와 토큰을 채팅이나 소스 파일에 붙여 넣지 마세요. Wrangler가 인증을 관리합니다. 별도 도메인 구매 없이 기본 `workers.dev` 주소를 사용합니다.

## 3. 서버 배포

`worker/wrangler.jsonc`의 `ALLOWED_ORIGINS`에 실제 게임 출처를 넣습니다. GitHub Pages 프로젝트 경로를 제외한 `https://plailystudio.github.io`처럼 작성합니다. `name`은 배포할 Worker의 이름입니다.

```powershell
npm.cmd run worker:deploy
```

배포 중 최초 Workers 하위 도메인 설정을 요청하면 Cloudflare 안내대로 설정합니다. 출력된 `https://type-battle-server.<계정>.workers.dev` 주소의 `/healthcheck`에서 `ok: true`를 확인합니다. 로그인과 실제 배포는 로컬 구현 검증과 별도 단계입니다.

## 4. GitHub Pages 연결 전환

현재 서버 주소는 저장소 기본값으로 설정되어 있으므로 GitHub 변수 등록 없이 배포할 수 있습니다. 다른 서버를 사용할 때만 저장소 **Settings → Secrets and variables → Actions → Variables**에 다음 값을 등록합니다.

| 변수 | 값 |
| --- | --- |
| `VITE_MULTIPLAYER_BACKEND` | `cloudflare` |
| `VITE_MULTIPLAYER_URL` | 배포된 `https://…workers.dev` 주소 |

변경된 코드를 저장소에 반영하고 **Deploy GitHub Pages** 워크플로를 실행합니다. 이 단계 전에는 공개 게임의 연결 대상이 바뀌지 않습니다. 기존 `?server=…trycloudflare.com` 링크는 Cloudflare 백엔드와 호환되지 않으므로 새 공개 페이지에서 초대 링크를 다시 만드세요.

실제 공개 페이지에서 두 플레이어로 검증하고 PC의 Docker와 터널을 종료한 뒤에도 작동하는지 확인합니다. 기존 Nakama 방식으로 되돌리려면 `VITE_MULTIPLAYER_BACKEND` 변수를 `nakama`로 설정하고 기존 `VITE_NAKAMA_HOST` 등 연결 설정을 확인한 뒤 Pages를 다시 배포합니다 (이때 기존 PC 서버가 필요합니다).

Worker 자동 배포는 아직 추가하지 않았습니다. 현재는 `worker:deploy`로 배포하며, 따라서 GitHub에 Cloudflare API 토큰을 등록할 필요도 없습니다.

## 5. 리더보드 확장 기반과 현재 한계

- 브라우저가 생성한 256비트 게스트 비밀키의 해시를 고정 유저 ID로 사용합니다. 키는 서버 주소별 localStorage에 저장하며, 서버에는 HTTPS 인증 헤더 또는 WebSocket 프로토콜 헤더로 전달합니다. 공개된 ID만으로 다른 사람을 사칭할 수는 없습니다.
- 각 연결은 별도 플레이어 ID를 사용해 같은 브라우저의 여러 탭에서도 테스트할 수 있습니다. 여러 탭의 기록은 같은 게스트 유저에 귀속됩니다.
- 브라우저 저장소를 지우거나 다른 기기·브라우저로 접속하면 다른 게스트입니다. 계정 복구·기기 간 동기화를 원하면 로그인과 계정 연결 기능이 추가로 필요합니다.
- 매 경기마다 별도 `roundId`를 발급하고 서버가 채점한 결과를 `state.result`로 확정합니다. 게임 방식·언어·문장·규칙 버전·유저별 기록을 포함합니다.
- 현재 결과는 방의 최신 경기 스냅샷입니다. **영구 경기 이력이나 리더보드는 아직 구현하지 않았습니다.** 재경기 시 최신 결과가 교체되고 빈 방 정리 시 삭제됩니다.
- 나중에 D1에 `(roundId, playerId)` 고유 키로 결과를 중복 없이 저장하고, 유저별 최고 기록·주간 순위를 조회하도록 추가할 수 있습니다. 동일 유저의 여러 탭은 랭킹 계산에서 별도 처리합니다. 사용자 지정 문장은 공식 문장 순위와 분리해야 합니다.
- 서버가 점수와 시간을 결정하지만, 자동 입력을 완전히 탐지하지는 않습니다. 현재 로컬 싱글플레이 기록은 서버 검증을 거치지 않으므로 공식 순위에 그대로 등록하면 안 됩니다.

생성 후 입장 없는 방은 60초, 모두 나간 방은 30초 뒤 정리합니다. 30분간 활동 없는 방도 정리합니다. 입력마다 전체 방을 DB에 저장하지 않아 무료 사용량을 줄이지만, 무료 한도 내의 수용 인원은 실제 운영 지표로 확인해야 합니다. 허용 출처·메시지 크기·연결별 메시지 빈도 제한은 포함하며, 공개 서비스 규모가 커지면 방 생성 남용 방지와 사용량 관리도 강화해야 합니다.

공식 참고: [Durable Objects Hibernation](https://developers.cloudflare.com/durable-objects/best-practices/websockets/), [무료 한도](https://developers.cloudflare.com/durable-objects/platform/pricing/), [향후 D1 요금·한도](https://developers.cloudflare.com/d1/platform/pricing/).
