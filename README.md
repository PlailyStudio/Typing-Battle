# TYPE / BATTLE

화이트·블랙 스타일의 타자배틀 웹게임. Vite + JavaScript 프런트엔드와 Nakama 서버 런타임 코드로 구성합니다.

## 프런트엔드 실행

폴더 안의 **`게임 실행.bat`를 더블클릭**하면 서버와 브라우저가 열립니다. 실행 창은 게임을 하는 동안 열어두세요. 종료할 때는 실행 창에서 `Ctrl+C`를 누르세요. 이 실행 파일은 프런트엔드용이며, 멀티플레이에는 아래 Nakama 실행이 추가로 필요합니다.

Node.js 22.12 이상에서 프로젝트 폴더 터미널에 입력하세요. Windows PowerShell에서 npm 실행 정책 오류가 나면 `npm` 대신 `npm.cmd`를 사용하세요.

```sh
npm install
npm run dev
```

터미널에 표시된 로컬 주소를 브라우저에서 여세요. 싱글플레이는 Nakama 없이 바로 동작합니다.

## 멀티플레이 실행

### GitHub Pages + 임시 터널 간편 실행 (Windows)

Docker Desktop을 직접 켜고 엔진이 준비되면 **`멀티플레이 실행.bat`를 더블클릭**하세요. Node.js와 cloudflared가 설치되어 있어야 합니다. 실행 파일이 서버를 빌드하고 Docker 서비스를 시작한 뒤, Quick Tunnel 주소를 찾아 서버 응답을 확인하고 `?server=...`가 포함된 GitHub Pages 링크를 브라우저에서 엽니다. 링크는 클립보드에도 복사됩니다. `게임 실행.bat`는 별도로 실행하지 않아도 됩니다.

게임에서 방을 만들고 초대 링크를 친구에게 보내세요. 실행 창은 게임 중 계속 열어두고, 종료할 때 창에서 `Q`를 누르면 이번 실행이 만든 터널만 종료됩니다. Docker 서비스는 계속 실행되며 필요하면 `docker compose down`으로 종료합니다. 서버 코드가 변경된 경우 실행 중인 Nakama를 재시작하므로 기존 경기는 종료됩니다. 다음 실행에서 터널 주소가 바뀌어도 GitHub Pages 재배포는 필요 없습니다.

기본 페이지 주소는 `https://plailystudio.github.io/Typing-Battle/`입니다. 변경하려면 `scripts/start-multiplayer.ps1`의 `PagesUrl` 기본값을 수정하세요. 이 실행 도구는 로컬에서만 사용하므로 Pages 재배포 없이 실행할 수 있지만, 배포된 게임에는 `server` 매개변수 지원이 포함되어 있어야 합니다. 오류 로그는 Git에서 제외된 `.local/multiplayer/`에 저장됩니다.

### 수동 실행

Docker Desktop을 실행한 뒤 아래 명령을 실행하세요.

```sh
npm run server:build
docker compose up -d
```

Nakama API는 7350 포트입니다. 서로 다른 브라우저 또는 두 개의 새 탭에서 웹게임을 열고 **방 생성 → 초대 링크 복사 → 링크로 자동 입장 → 준비 완료 → 방장 경기 시작** 순서로 진행하세요. 참가 코드는 숫자 6자리입니다. 대기실에서 초대 링크를 복사해 공유하면 링크를 연 사람이 자동으로 방에 입장합니다. 서버가 사용 중인 코드의 중복을 방지하며, 방 참가 시 코드로 실제 매치 ID를 조회합니다. 입장 후 대기실에서 닉네임을 변경할 수 있습니다. 게스트 ID는 탭 세션에 저장하므로 탭 복제보다 새 탭에서 주소를 직접 열어주세요.

다른 호스트의 Nakama에 연결하려면 `.env.example`을 `.env.local`로 복사해 주소를 수정한 뒤 Vite를 재시작하세요. HTTPS 프런트엔드에는 TLS로 접근 가능한 Nakama 주소와 `VITE_NAKAMA_SSL=true`가 필요합니다.

서버 코드 변경 후 `npm run server:build`와 `docker compose restart nakama`를 실행하세요. 종료는 `docker compose down`입니다. 기본 설정은 로컬 개발용입니다.

## GitHub Pages 배포

`.github/workflows/pages.yml`은 `main` 브랜치가 갱신될 때 GitHub Pages를 자동 배포합니다. 저장소의 **Settings → Pages → Source**를 **GitHub Actions**로 설정하고, **Settings → Secrets and variables → Actions**에 아래 값을 등록하세요.

- 변수 `VITE_NAKAMA_HOST`: Cloudflare Tunnel에 연결한 Nakama 공개 호스트명(프로토콜과 경로 제외)
- 시크릿 `VITE_NAKAMA_KEY`: Nakama `socket.server_key`와 같은 값

배포 빌드는 HTTPS/WSS용 포트 `443`과 `VITE_NAKAMA_SSL=true`를 사용합니다. Cloudflare Tunnel의 공개 호스트는 방장 PC의 `http://localhost:7350`으로 전달해야 합니다. 방장 PC에서 Docker와 Cloudflare Tunnel이 실행 중일 때만 멀티플레이 서버에 접속할 수 있습니다.

개인 도메인 없이 Quick Tunnel을 사용할 때는 아래처럼 Nakama를 공개합니다.

```powershell
cloudflared tunnel --url http://localhost:7350
```

출력된 `https://무작위이름.trycloudflare.com` 주소에서 호스트명만 GitHub Pages 주소의 `server` 매개변수로 전달하세요.

```text
https://사용자명.github.io/저장소명/?server=무작위이름.trycloudflare.com
```

이 주소에서 방을 만들면 `room`과 `server`가 모두 들어간 초대 링크가 생성됩니다. Quick Tunnel 주소가 바뀌어도 GitHub Pages를 다시 빌드할 필요 없이 `server` 값만 새 호스트명으로 바꾸면 됩니다. `server`에는 HTTPS 호스트명만 허용하며 경로나 사용자 정보가 포함된 주소는 사용하지 않습니다.

## 구현 내용

- 대기실의 **방 설정**에서 방장이 방 이름·최대 인원·언어·경기 방식·제한 시간·사용할 문장·출제 순서를 수정하고 저장할 수 있습니다. 변경 사항은 모두에게 반영되며 참가자 준비 상태가 해제됩니다. 경기 중에는 변경할 수 없고 현재 참가자 수보다 최대 인원을 줄일 수 없습니다. 재경기 대기실에서도 설정을 변경할 수 있습니다.
- 추가 입력 전환 모드에서 정답의 마지막 한글이 아직 조합 중이어도 Enter 한 번으로 다음 문장(마지막 문장이면 완주)으로 넘어갑니다. 반복 Enter와 이전 조합 세션의 뒤늦은 이벤트는 중복 전환하지 않습니다.

- 싱글플레이 / 방 생성 / 방 참가 탭, 2~4인 대기실, 준비와 방장 시작
- 상단에 상대 문장·입력 내용·커서·오타·한글 조합 상태를 재현한 미니 화면
- 하단의 큰 내 입력 화면, 3초 카운트다운, 60초 경기, 전환 키로 문장 완성 확정
- 서버가 시작·종료, 문장 일치 여부, 진행도·정확도 및 결과를 관리
- 완료 시간 또는 진행도·정확도로 순위 결정, 동점 표시, 이탈 처리, 재경기
- 개인 최고 타수(타/분)를 현재 브라우저에 저장
- 로비·결과 화면에는 편안한 96 BPM의 자체 합성 배경음악을 반복 재생합니다. 카운트다운 동안에는 배경음악을 멈추고, 3초가 끝나 경기가 시작되면 부드러운 리듬의 120 BPM 음악을 재생합니다. 첫 클릭 또는 키 입력 후 시작하며 화면 전환 시 부드럽게 전환합니다. 개인 설정에서 효과음과 별도로 켜기·끄기 및 볼륨을 저장할 수 있고, 다른 탭으로 이동하면 음악이 멈춥니다.
- 문장을 정확히 입력하면 전환 대기 상태가 됩니다. Enter를 누르거나 정답 뒤에 문자·공백을 추가로 입력하거나 모바일의 다음 문장 버튼을 눌러야 완성한 문장 수와 진행도가 올라갑니다. 마지막 문장도 전환 동작으로 완주를 확정하며, 이 시각을 완주 시간으로 기록합니다. 싱글·멀티 및 시간 제한 모드에 동일하게 적용됩니다.

타수는 `정확하게 진행한 자소 수 ÷ 경기 경과 초 × 60`으로 계산합니다. 한글은 초성·중성·종성을 분리하고 복합 모음·겹받침은 각각 두 자소로 셉니다(한=3타, 과=3타, 값=4타). 쌍자음은 1타로 세며 Shift는 더하지 않습니다. 영문·숫자·공백·문장부호는 각 1타입니다. 오타 수정이나 문장 전환 키는 타수를 늘리지 않습니다. 경기 시작부터 계산하므로 입력 전 대기와 수동 문장 전환 대기도 시간에 포함됩니다. 이전 음절 기준 최고 기록은 남겨두고 새 자소 기준 기록을 별도 저장합니다.

[한컴 공식 안내](https://support.hancomtaja.com/27112623-a842-4138-97f6-c0c6be83c5f6)의 자소 단위·가중치 없는 계산 원칙을 반영했습니다. 공식 안내에 세부 자소 처리와 오타 처리 공식은 공개되어 있지 않아 한컴의 모든 모드와 수치가 완전히 동일함을 보장하지는 않습니다. 이 게임은 60초 경기 전체의 평균 속도를 표시합니다.

상대 화면은 영상 스트리밍이 아니라 게임 상태를 동기화해 그립니다. 조합 중 글자는 점수에서 제외합니다.

## 검증 및 범위

```sh
npm test
npm run build
```

규칙 및 서버 핸들러 테스트를 포함합니다. 실제 로컬 Nakama 서버에 SDK 클라이언트 두 개를 연결해 방 입장·준비·시작·한글 조합 및 문장 완료 동기화를 확인했습니다. 재검증 명령은 `node scripts/smoke-multiplayer.js`입니다. 현재 버전은 간단한 MVP로, 공개 방 목록·재접속·서버 기록 저장·입력 자동화 탐지는 포함하지 않습니다. 서버는 전달받은 문자열로 정답을 검사하지만 실제 키 입력 여부를 증명하지는 않습니다.

## 파일 구성

- `src/main.js`, `src/style.css`: UI, 싱글플레이, Nakama 클라이언트
- `shared/rules.js`: 공통 문장과 채점 규칙
- `server/main.js`: Nakama authoritative match와 방 생성 RPC
- `docker-compose.yml`: PostgreSQL + Nakama 로컬 실행

연결 구현 참고: [Nakama JavaScript 가이드](https://heroiclabs.com/docs/nakama/client-libraries/javascript/), [Match handler API](https://heroiclabs.com/docs/nakama/server-framework/typescript-runtime/function-reference/match-handler/).
