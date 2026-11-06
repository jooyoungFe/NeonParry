# Lobby & Duel API v1

JSON API 접두사는 `/api/v1`입니다. 방 참가자 토큰으로 인증하며 전투 판정은 서버가 수행합니다. 실제 규칙은 [DUEL.md](DUEL.md)를 참고하세요.

| 요청 | 인증 | 동작 |
| --- | --- | --- |
| `GET /health` | 없음 | `{status:"ok",apiVersion:1,storage:"memory"}` |
| `POST /api/v1/matchmaking` | 없음 | `{name,mode?}`로 1대1 랜덤 매칭 등록 |
| `GET /api/v1/matchmaking/:ticketId` | 티켓 Bearer | 매칭 상태 확인·대기 수명 연장 |
| `DELETE /api/v1/matchmaking/:ticketId` | 티켓 Bearer | 매칭 대기 취소·티켓 정리 |
| `POST /api/v1/rooms` | 없음 | `{name,mode?}`로 방 생성 |
| `POST /api/v1/rooms/:code/join` | 없음 | `{name}`으로 플레이어 참가 |
| `GET /api/v1/rooms/:code` | Bearer | 공개 로비 상태 조회 |
| `POST /api/v1/rooms/:code/ready` | Bearer | `{ready:true/false}`로 본인 준비 변경 |
| `GET /api/v1/rooms/:code/battle` | Bearer | 인증된 SSE 전투 상태 스트림 |
| `GET /api/v1/rooms/:code/battle/state` | Bearer | 전투 상태 한 번 조회 |
| `POST /api/v1/rooms/:code/input` | Bearer | 공격·수비·대상·업그레이드 입력 |
| `GET /api/v1/rooms/:code/ping` | Bearer | 왕복 시간 측정을 위한 `{nonce,serverTime}` 발급 |
| `POST /api/v1/rooms/:code/ping` | Bearer | `{nonce}`로 측정 완료, `{rttMs,guardDelayMs,serverTime}` 반환 |
| `DELETE /api/v1/rooms/:code` | Bearer | 탈퇴 / 진행 중 해당 참가자 기권 |

## 랜덤 매칭

`POST /matchmaking`은 HTTP 201의 `{ticketId,ticketToken,status,serverTime,expiresAt}`를 반환합니다. `ticketId`는 24자리 소문자 hex, `ticketToken`은 본인에게만 주는 43자리 토큰입니다. 티켓 조회·취소는 `Authorization: Bearer <ticketToken>`을 사용합니다. 방 참가 토큰과 별개이며 URL에 넣지 않습니다.

`status`는 `waiting` 또는 `matched`입니다. 같은 서버의 같은 모드 대기자 중 무작위 상대와 연결되면 자동 준비된 방과 3초 뒤 시작할 매치를 만듭니다. 매칭된 응답에는 `{room,playerId,playerToken}`도 포함됩니다. 이후 방 API·전투 SSE에는 이 `playerToken`을 사용합니다. 상대가 인계 전에 나가서 방이 사라지면 `status: cancelled, reason: opponent_left`가 될 수 있습니다.

대기 티켓은 15초 후 만료하며 인증된 GET 조회로 15초씩 연장합니다. 공식 UI는 1초마다 조회합니다. 매칭된 티켓은 60초 안에 인계해야 하며, 전투 SSE를 연결하면 인계 완료로 기록됩니다. 인계 전 취소·만료는 해당 방을 정리하고 아직 인계되지 않은 상대를 다시 대기시킵니다. 인계 완료 티켓 정리는 진행 중 대전을 취소하지 않습니다. DELETE 응답은 `{cancelled:true,serverTime}`입니다.

```js
const ticket = await api.findMatch('Player');
const state = await api.getMatch(ticket.ticketId, ticket.ticketToken);
if (state.status === 'matched') {
  // state.room.code + state.playerToken으로 connectBattle 호출
}
// 대기 취소 또는 전투 연결 인계 후 티켓 정리:
await api.cancelMatch(ticket.ticketId, ticket.ticketToken);
```

실력 등급·지역별 큐는 없으며 같은 서버에 접속한 대기자끼리 매칭됩니다.

## 방과 매치

생성·참가는 HTTP 201의 `{room,playerId,playerToken}`을 반환합니다. 이름은 선택 사항(기본 Player), 앞뒤 공백 제거 후 1~24자이며 제어 문자는 허용하지 않습니다. 모드는 `clash`(친구방 2~8명) 또는 `classic`(2명)이며 API에서 생략하면 `classic`입니다. 게임 메뉴는 `clash`를 사용합니다. 방 상태의 `mode`와 `maxPlayers`에서 확인할 수 있습니다. 다른 참가자의 토큰은 공개하지 않습니다. 모든 인증 요청은 `Authorization: Bearer <playerToken>` 헤더를 사용하며 URL에 토큰을 넣지 않습니다.

```json
{
  "code": "ABC234",
  "hostId": "public-player-id",
  "phase": "starting",
  "revision": 4,
  "players": [
    {"id":"public-player-id","name":"Host","ready":true},
    {"id":"another-player-id","name":"Guest","ready":true}
  ],
  "match": {"id":"server-match-id","seed":12345,"startAt":1800000003000},
  "serverTime":1800000000000
}
```

시각은 서버 Unix epoch milliseconds입니다. 대기 중 `match`는 null입니다. 두 명 이상 모여 모두 준비하면 `starting`, 3초 뒤 `playing`, 승패 확정 시 `finished`로 전환됩니다. 시작 후 준비 취소 대신 탈퇴합니다. 종료 후에는 모두의 준비가 초기화되며, 다시 모두 준비하면 같은 방에서 새 매치를 시작합니다. `clash`에서 나간 참가자는 탈락하고, 두 명 이상 살아 있으면 대전이 계속됩니다. 마지막 참가자가 나가거나 유휴 만료되면 방을 삭제합니다.

## 입력과 판정

```json
{"type":"attack","dir":"up","seq":0}
```

`type`은 `attack` 또는 `guard`, `dir`은 `up/right/down/left`, `seq`는 0~2147483647 정수입니다. 선택적 `matchId`는 현재 매치 ID이며, 공식 클라이언트는 이전 경기의 지연 입력을 막기 위해 자동으로 보냅니다. 같은 클라이언트에서 seq를 증가시키세요. 최근 128개 범위의 중복을 제거하며, 더 오래된 요청은 거절합니다. 클라이언트 시각·피해·승패 필드는 판정에 사용하지 않습니다.

`clash`에서는 `{type:"target",targetId,seq}`로 살아 있는 상대를 선택합니다. 공격에 `targetId`를 붙여 해당 공격만 다른 상대에게 보낼 수도 있습니다. 업그레이드는 현재 본인에게 온 `offer`의 ID와 선택지 ID를 `{type:"upgrade",offerId,choiceId,seq}`로 보냅니다.

형식이 유효한 요청은 HTTP 200으로 `{ok,reason?,attackId?,impactAt?,guarded?,perfect?,state}`를 반환합니다. `state`는 아래 전투 상태입니다. 에너지 부족(`energy`), 재사용 대기(`cooldown`), 중복(`duplicate`), 시작 전(`countdown`), 종료 후(`finished`) 등은 `ok:false`로 반환합니다. 허용된 수비 입력이 공격을 막지 못한 경우 `ok:true,guarded:false`입니다. `clash`의 헛방어는 취약률을 4%p 올리며, `miss` 이벤트에 페널티와 변경된 취약률을 담습니다. `guarded:true`일 때 `perfect`로 정밀 패링 여부를 확인합니다.

`clash` 온라인 판정은 서버가 확인한 왕복 지연의 절반을 최대 120ms까지 패링 수신 시각에 보정합니다. `classic`은 수신 시각 그대로 판정합니다. 클라이언트 시각은 사용하지 않습니다. 원래 쉬움 난이도의 도착 ±360ms 패링 창과 ±100ms 정밀 창을 사용하며, 패링 창이 지난 뒤 피해를 확정합니다. 방향별 재사용 대기시간은 300ms입니다.

## 전투 스트림

`GET .../battle`은 `Content-Type: text/event-stream`이며 즉시 상태를 한 번 보냅니다. `clash`는 전투 변화가 있거나 마지막 전송 후 약 1초가 지났을 때 갱신합니다. 입력 후에도 갱신하며 종료 상태를 보낸 뒤 스트림을 닫습니다.

```text
event: state
data: {"room":{...},"battle":{...},"serverTime":1800000004000}

```

`battle`에는 `now/startAt/status`, `winnerId`, `finishedAt`, `finishReason`, `rules`, `players`, `attacks`, 최근 `events`가 있습니다. 플레이어 상태는 `{id,vulnerability,energy,streak}`, 공격은 `{attackId,from,to,dir,launchedAt,impactAt,state}`입니다. `clash`에는 플레이어의 `eliminated`, `targetId`, `offer`, `upgrades`와 공격의 `kind`, `source`, 전투의 `speedPercent`와 `rechargeRate`가 추가됩니다. 보스전 중 `battle.boss`는 보스 종류와 시작 시각, `players[].boss`는 각자의 패턴과 진행을 담습니다. 이때 상대 공격과 능력 선택은 `boss_active`로 거절합니다. `status`는 `countdown/running/finished`, `finishReason`은 `vulnerability/draw/forfeit`이며 무승부의 `winnerId`는 null입니다. 스트림 응답에도 참가 토큰은 포함하지 않습니다.

재연결은 같은 토큰으로 스트림을 다시 엽니다. 플레이어당 최대 두 스트림을 허용하고, 마지막 연결 종료 후 15초 안에 복귀하지 않으면 기권합니다. 한 번 조회하는 `/battle/state`는 지속 연결로 취급하지 않습니다. 정상 플레이 중에는 스트림을 유지하세요.

클라이언트 사용 예:

```js
const api = NeonOnline.createClient(); // config.js 또는 명시한 API 주소
const host = await api.createRoom('Host', 'clash');
// 다른 브라우저/기기에서 같은 코드로 api.joinRoom(code, 'Guest')
await api.setReady(host.room.code, host.playerToken, true);
// 모든 참가자 준비 후 연결. seq는 sendInput이 자동으로 증가시킵니다.
const connection = api.connectBattle(host.room.code, host.playerToken, {
  onState: state => render(state),
  onError: error => showStatus(error.code)
});
await api.sendInput(host.room.code, host.playerToken, { type: 'attack', dir: 'up' });
// 종료하거나 화면을 떠날 때:
connection.close();
await api.leaveRoom(host.room.code, host.playerToken);
```

클라이언트는 일반 요청에 10초 타임아웃을 사용하며 스트림 단절 시 자동 재연결합니다. 토큰은 호출자가 현재 세션에서만 보관합니다. 모듈 로드만으로 접속하거나 저장하지 않습니다.

## 오류와 제한

오류 형식은 `{"error":{"code":"ROOM_FULL","message":"..."}}`입니다. 클라이언트 오류에는 `code`, `status`가 있습니다.

- 400: JSON·이름·준비 값·입력 형식 오류
- 401: 토큰 없음·틀림·다른 방 토큰
- 403: 허용되지 않은 Origin
- 404: 방·티켓 만료/없음·잘못된 경로
- 409: 만원·이미 시작·양쪽 준비 전 전투 요청·이전 매치 ID(`STALE_MATCH`)
- 413: 2 KiB 초과 본문
- 415: JSON이 아닌 Content-Type
- 429: IP 요청 제한 또는 플레이어당 스트림 상한
- 503: 최대 방 1,000개 또는 매칭 티켓 2,000개 도달

인증된 참가자별 로비 300회/분, 입력 1,800회/분, 핑 60회/분을 제한합니다. 인증 없이 방 생성·참가를 할 때는 IP당 300회/분, 매칭 등록은 30회/분입니다. 제한 응답에 `Retry-After`가 포함됩니다. 방은 인증된 활동 없이 15분이면 만료되며 활성 스트림은 수명을 연장합니다. 재시작 복구·영구 전적은 제공하지 않습니다.
