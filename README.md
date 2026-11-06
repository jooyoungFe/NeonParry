# Neon Parry

**1.4.3 — 듀얼과 8인 친구방** · [공개 게임](https://neon-parry.onrender.com/) · [패치노트](CHANGELOG.md)

기존 캐릭터·바이러스·전투 화면·패링 효과를 그대로 사용하는 1:1 듀얼입니다. 기존 쉬움 난이도의 이동 속도와 패링 판정으로 공격과 수비를 주고받습니다. CPU 연습, 친구 초대방, 같은 서버의 다른 플레이어와 랜덤 매칭을 지원합니다. **제한시간 없이 취약률 100%에 도달하면 패배**합니다. 기존 싱글플레이와 로컬 기록도 유지합니다.

[듀얼 규칙·조작](docs/DUEL.md) · [서버 실행 안내](docs/SERVER.md) · [Render 배포](docs/RENDER.md) · [Codespaces 실행](docs/CODESPACES.md) · [구조·배포](docs/ARCHITECTURE.md) · [API 계약](docs/ONLINE_API.md)

## 바로 실행

Node.js 22.12 이상이면 패키지 설치 없이 실행합니다.

```sh
npm run dev:duel
```

`http://127.0.0.1:8000`에서 **Play → Duel / 듀얼**을 선택하세요. CPU 연습을 누르거나, 브라우저 탭 두 개에서 각각 **랜덤 매칭**을 누르면 대전을 확인할 수 있습니다. 친구 초대는 방 만들기 → 방 코드로 참가 → 양쪽 준비 순서입니다. 개발 서버는 게임과 API를 같은 주소에 제공하며 `frontend/config.js`를 수정하지 않습니다.

방향키/WASD는 패링, `Shift + 방향키/WASD`는 공격입니다. 기존 스킬 버튼 또는 Space로 공격을 선택한 뒤 방향을 입력할 수도 있습니다. 터치는 기존 경기장 구역을 탭해 패링하고 해당 구역을 위아래/좌우로 쓸어 공격합니다. 공격 한 번 후에는 수비로 돌아옵니다.

```sh
npm test
npm run build:web
```

## 서버가 필요한가요?

**CPU 연습과 싱글플레이에는 필요 없습니다.** 다른 사람과 인터넷에서 대전하려면 운영자가 공용 서버 하나를 실행해야 합니다. 플레이어마다 서버를 실행하는 것은 아닙니다. 두 사람이 같은 서버에 접속해야 랜덤 매칭과 초대방이 연결됩니다.

가장 간단한 구성은 게임과 대전 API를 한 서버에서 함께 제공하는 것입니다.

```sh
ALLOWED_ORIGINS=https://game.example.com npm run start:server
```

`game.example.com`은 실제 배포 주소로 바꾸세요. 기본 바인딩은 `0.0.0.0:8080`이며 호스팅에서 지정하는 `PORT`도 따릅니다. 인터넷 공개에는 HTTPS 주소와 계속 실행되는 Node.js/컨테이너 호스트가 필요합니다. 자세한 로컬·같은 와이파이·인터넷 설정은 [서버 안내](docs/SERVER.md)에 정리했습니다.

**GitHub에서 실행하려면 Codespaces를 사용합니다.** 저장소의 Code → Codespaces에서 환경을 만들면 게임과 듀얼 서버가 자동으로 시작됩니다. Ports에서 8080을 Public으로 바꾸면 다른 사람도 접속할 수 있습니다. 개발용 환경이므로 유휴 시 자동으로 중지되며, 계속 켜 두는 호스팅은 아닙니다. [실행·공개·무료 한도 안내](docs/CODESPACES.md)를 확인하세요.

**GitHub Pages는 화면 파일만 배포합니다.** Pages를 계속 쓰려면 별도 대전 서버를 운영하고 `NEON_API_BASE_URL`에 HTTPS 서버 주소를 설정해야 합니다. 위 통합 서버를 사용하면 게임도 같은 주소에 있으므로 Pages 없이 실행할 수 있습니다.

Render 배포는 저장소의 `render.yaml`을 사용합니다. 무료 Web Service 하나에 게임과 듀얼 API를 함께 올립니다. [Render 배포 안내](docs/RENDER.md)에 연결 순서를 정리했습니다.

## 구조

| 폴더 | 역할 |
| --- | --- |
| `frontend/` | 원래 게임·렌더러, 듀얼 연결, CPU 연습, 공유 전투 규칙 |
| `backend/` | 랜덤 매칭·방·참가 토큰·준비, 전투 판정·SSE 상태 전송 |
| `desktop/` | Electron 창·전체화면·점수 복사 |
| `tests/`, `backend/tests/` | 게임·전투 규칙·HTTP·UI·데스크톱 검사 |
| `scripts/`, `build/` | 개발·공용 서버, 웹·Electron 패키징 |

정적 게임만 실행하려면 `npm run dev:frontend`(Python 3), API만 실행하려면 `npm run start:backend`를 사용합니다. 별도 API 연결은 듀얼의 접속 설정 또는 `frontend/config.js`의 공개 `apiBaseUrl`로 지정합니다. 토큰이나 비밀번호는 설정 파일에 넣지 않습니다.

## 데스크톱

```sh
npm ci
npm start
npm run build:win
# macOS: npm run build:mac
```

출력은 `release/`입니다. 기존 `app://neon-parry/neon-parry.html` origin을 유지하여 로컬 기록을 보존했습니다. Electron 앱에서는 기존 게임과 CPU 연습을 사용하며 온라인 대전은 서버 주소를 브라우저에서 열어 실행합니다. 백엔드는 앱에 포함하지 않습니다.

## 보존 자료

첨부 원본은 `imports/Neon-Parry-Source.zip`, 이전 단일 HTML은 `legacy/single-file/`에 보관합니다. [최초 소스 분석](docs/SOURCE_ANALYSIS.md)은 당시 구조의 기록입니다. [보스·도전과제·도감](docs/PROGRESSION.md)도 유지됩니다. 원본 `README.txt`보다 현재 README의 폴더 안내를 우선합니다.
