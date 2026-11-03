# GitHub에서 서버 실행

GitHub Codespaces 하나에서 게임 화면과 온라인 듀얼 API를 함께 실행합니다. GitHub Pages는 정적 게임 화면만 제공하며 대전 서버를 실행하지 않습니다.

## 시작

1. GitHub 저장소에서 **Code → Codespaces → Create codespace on main**을 선택합니다. 머신은 **2-core**를 사용합니다.
2. 개발 환경이 열리면 서버가 자동으로 시작됩니다. Node 22를 사용하며, 서버 실행에 `npm install`은 필요하지 않습니다.
3. 아래 **Ports** 탭에서 **8080**을 찾습니다. 우클릭 → **Port Visibility → Public**으로 바꿉니다. 조직 정책상 Public이 허용되어야 합니다.
4. 해당 포트의 브라우저 열기 버튼으로 접속합니다. 주소 형식은 `https://<codespace-name>-8080.app.github.dev`입니다. 이 주소를 상대방에게 공유합니다.

이 주소는 HTTPS 게임 화면과 듀얼 API를 함께 제공합니다. 연결 설정을 입력할 필요 없이 같은 주소에서 방을 만들고 참가할 수 있습니다. 포트 공개 설정은 자동으로 바꾸지 않습니다. 공개하면 주소를 아는 사람은 로그인 없이 게임과 API에 접근할 수 있습니다.

서버 내부는 `0.0.0.0:8080` HTTP이며, 외부 HTTPS는 GitHub 포트 포워딩이 제공합니다. CORS는 현재 Codespace의 정확한 HTTPS 출처와 `https://jooyoungfe.github.io`, 로컬 테스트 주소만 허용합니다. GitHub 프록시가 같은 출처 요청을 전달할 때 사용하는 `https://localhost:8080`도 이 서버에서만 허용합니다. 다른 출처를 전체 허용하지 않습니다.

## 재시작과 확인

Codespace를 다시 시작하면 서버도 자동으로 시작됩니다. 같은 서버가 이미 실행 중이면 중복으로 띄우지 않습니다. 수동으로 확인하거나 다시 실행하려면 Codespaces 터미널에서 다음을 실행합니다.

```bash
node scripts/codespaces.cjs
```

출력에 게임 주소, PID와 로그 경로가 나옵니다. 로그와 실행 상태 파일은 OS 임시 디렉터리에 있으며 공개 `frontend`에 들어가지 않습니다. 다른 프로그램이나 오래된 서버가 8080을 쓰고 있으면 자동으로 종료하지 않고 오류를 표시합니다. 해당 프로세스를 확인하고 수동 종료한 뒤 위 명령을 다시 실행하세요.

재시작하면 포트 공개 상태가 **Private**으로 돌아갈 수 있으므로 **Ports → 8080 → Port Visibility → Public**을 다시 확인하세요. 새 Codespace를 만들면 주소도 바뀝니다. GitHub Pages에서도 듀얼을 연결하려면 저장소 **Settings → Secrets and variables → Actions → Variables**의 `NEON_API_BASE_URL`에 서버의 HTTPS 주소를 넣고 Pages 워크플로를 다시 실행합니다. [서버 안내](SERVER.md#github-pages를-계속-쓰려면)를 참고하세요.

대전 방과 진행 상태는 메모리에 저장되므로 서버나 Codespace가 재시작되면 사라집니다.

## 가동 시간과 사용량

Codespaces는 개발 환경입니다. 기본 유휴 제한은 30분이며, 유휴 제한을 설정할 수 있는 최대값은 4시간입니다. 한 번에 실행 가능한 최대 가동 시간은 12시간입니다. 이 저장소는 GitHub 기본 유휴 설정과 계정의 사용량·청구 설정을 변경하지 않습니다. Codespace가 멈추면 공유 주소도 접속되지 않으며 Codespace를 다시 시작해야 합니다.

개인 GitHub Free 계정에는 매월 120 core-hours와 15 GB-month 저장 공간이 포함됩니다. 2-core 머신 기준 계산 시간은 최대 60시간입니다. 다른 Codespace 사용량과 저장 공간도 같은 한도를 사용합니다. 무료 한도를 다 쓰면 사용을 멈추고, 별도 결제 승인을 하지 않은 상태에서 과금 설정을 바꾸지 마세요. 항시 가동 서버 용도로 무료 제공되는 서비스는 아닙니다.

- [포트 공개 설정](https://docs.github.com/en/codespaces/developing-in-a-codespace/forwarding-ports-in-your-codespace)
- [유휴 제한](https://docs.github.com/en/codespaces/setting-your-user-preferences/setting-your-timeout-period-for-github-codespaces)
- [최대 가동 시간](https://docs.github.com/en/codespaces/about-codespaces/understanding-the-codespace-lifecycle)
- [사용량과 요금](https://docs.github.com/en/billing/concepts/product-billing/github-codespaces)
