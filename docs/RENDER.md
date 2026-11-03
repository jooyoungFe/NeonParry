# Render 서버

게임 화면과 듀얼 서버를 Render Web Service 하나에서 실행합니다.

1. Render에서 **New → Blueprint**를 선택하고 GitHub의 `jooyoungFe/NeonParry` 저장소, `main` 브랜치를 연결합니다.
2. `render.yaml` 설정을 확인합니다. **Free**, **Singapore**, 인스턴스 **1개**입니다. 유료 서비스나 데이터베이스는 만들지 않습니다.
3. 배포가 끝나면 제공된 `https://…onrender.com` 주소를 엽니다. `/health`에서 `status: "ok"`가 나오면 서버가 실행 중입니다.

Render가 제공하는 `RENDER_EXTERNAL_URL`을 게임 서버의 허용 출처에 자동으로 추가합니다. 게임과 API가 같은 주소에 있어 별도 접속 설정이 필요 없습니다. Node 22와 실행 명령은 `backend/Dockerfile`에 들어 있습니다.

GitHub Pages 주소도 계속 사용하려면 GitHub 저장소 **Settings → Secrets and variables → Actions → Variables**의 `NEON_API_BASE_URL`을 Render의 HTTPS 주소로 바꾸고 Pages 워크플로를 다시 실행합니다. 서버는 `https://jooyoungfe.github.io` 접속도 허용합니다.

무료 서비스는 15분간 요청이 없으면 중지되고, 다음 접속 때 다시 켜지는 데 약 1분이 걸립니다. 무료 실행 시간은 워크스페이스 전체 월 750시간이며 대역폭·빌드 한도도 적용됩니다. 서버가 재시작되면 메모리에 있던 방과 진행 중인 경기는 사라집니다. 기록은 기존처럼 각 브라우저에 보관됩니다.

- [Blueprint 설정](https://render.com/docs/blueprint-spec)
- [무료 서비스 조건](https://render.com/docs/free)
- [Render 기본 환경변수](https://render.com/docs/environment-variables)
