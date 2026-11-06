'use strict';
const http=require('node:http');
const{RoomStore,ApiError}=require('./rooms.cjs');
const{MatchmakingStore}=require('./matchmaking.cjs');
const DEFAULT_ORIGINS=['http://localhost:8000','http://127.0.0.1:8000','https://qqock2e.github.io','https://jooyoungfe.github.io'];
function parseOrigins(text){
  const values=text===undefined?DEFAULT_ORIGINS:text.split(',').map(s=>s.trim()).filter(Boolean);
  for(const origin of values){let url;try{url=new URL(origin);}catch{throw Error('Invalid ALLOWED_ORIGINS origin.');}if(!['http:','https:'].includes(url.protocol)||url.origin!==origin)throw Error('ALLOWED_ORIGINS must contain exact HTTP(S) origins without paths.');}
  return new Set(values);
}
function createServer({store=new RoomStore(),matchmaking,origins=parseOrigins(process.env.ALLOWED_ORIGINS),rateLimit=300,inputRateLimit=1800,matchmakingRateLimit=30,pingRateLimit=60,tickMs=33,heartbeatMs=1000}={}){
  const buckets=new Map(),streams=new Map(),lastSent=new WeakMap();let battleTimer=null;
  function limit(key,max,res){
    const now=Date.now(),previous=buckets.get(key),bucket=previous&&now<previous.resetAt?previous:{count:0,resetAt:now+60000};
    bucket.count++;buckets.set(key,bucket);
    if(bucket.count>max){res.setHeader('Retry-After',Math.ceil((bucket.resetAt-now)/1000));throw new ApiError(429,'RATE_LIMITED','Too many requests.');}
  }
  function authenticate(token,verify,ip,res,message){
    try{if(!token)throw new ApiError(401,'TOKEN_REQUIRED',message);return verify();}
    catch(error){limit('invalid:'+ip,rateLimit,res);throw error;}
  }
  function stopTimer(){if(!streams.size&&battleTimer){clearInterval(battleTimer);battleTimer=null;}}
  function shouldSend(room,now){
    const last=lastSent.get(room);
    return room.mode!=='clash'||!last||last.battle!==room.battle||last.revision!==room.revision||last.event!==room.battle.nextEventId||last.status!==room.battle.status||now-last.at>=heartbeatMs;
  }
  function sendState(code,state){
    const viewers=streams.get(code);if(!viewers)return;
    const room=store.rooms.get(code);if(!room?.battle)return;
    lastSent.set(room,{battle:room.battle,revision:room.revision,event:room.battle.nextEventId,status:room.battle.status,at:state.serverTime});
    const frame='event: state\ndata: '+JSON.stringify(state)+'\n\n',finished=state.battle.status==='finished';
    for(const viewer of viewers){
      const res=viewer.res;if(res.destroyed||res.writableEnded)continue;
      if(viewer.battle!==room.battle){res.end();continue;}
      // An eight-player snapshot may exceed the write high-water mark. Skip
      // intermediate frames while that buffer drains; always send the result.
      if(res.writableNeedDrain){
        const now=Date.now();viewer.blockedAt??=now;
        if(now-viewer.blockedAt>=5000){res.destroy();continue;}
        if(!finished)continue;
      }else viewer.blockedAt=null;
      if(finished)res.end(frame);else res.write(frame);
    }
  }
  function closeStreams(code,playerId){const viewers=streams.get(code);if(viewers)for(const viewer of viewers)if(!playerId||viewer.playerId===playerId)viewer.res.end();}
  function leaveMember(code,token,member=store.authorize(code,token)){
    const{room,entry}=member;
    if(room.mode==='clash'){
      const result=store.leave(code,token);
      if(!result.closed&&room.battle)sendState(code,store.battleSnapshot(room));
      closeStreams(code,entry.id);return result;
    }
    const final=store.forfeit(code,token);if(final)sendState(code,final);closeStreams(code);return store.leave(code,token);
  }
  function tick(){
    for(const [code,viewers]of streams){
      const room=store.rooms.get(code);
      if(!room||!room.battle){closeStreams(code);continue;}
      const now=store.now();if([...viewers].some(viewer=>!viewer.res.destroyed))room.touchedAt=now;
      if(room.mode==='clash')store.advanceBattle(room,now);
      if(shouldSend(room,now))sendState(code,store.battleSnapshot(room));
    }
    stopTimer();
  }
  function startStream(code,token,req,res){
    matchmakingStore.prune();
    const{room,entry,battle}=store.connect(code,token);
    if(room.presence.get(entry.id).connections>2){store.disconnect(room,entry.id);throw new ApiError(429,'STREAM_LIMIT','At most two battle connections are allowed per player.');}
    matchmakingStore.handoff(code,entry.id);
    res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-store, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no','X-Content-Type-Options':'nosniff'});
    res.flushHeaders();req.socket.setNoDelay(true);
    const viewer={res,playerId:entry.id,battle,blockedAt:null};let viewers=streams.get(code);if(!viewers){viewers=new Set();streams.set(code,viewers);}viewers.add(viewer);
    res.on('error',()=>res.destroy());
    res.once('close',()=>{viewers.delete(viewer);store.disconnect(room,entry.id,battle);if(!viewers.size)streams.delete(code);stopTimer();});
    sendState(code,store.battleSnapshot(room));
    if(!battleTimer){battleTimer=setInterval(tick,tickMs);battleTimer.unref();}
  }
  const matchmakingStore=matchmaking||new MatchmakingStore({rooms:store,onAbandon:member=>leaveMember(member.code,member.playerToken)});
  const server=http.createServer(async(req,res)=>{
    const json=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(body));};
    res.setHeader('Vary','Origin');
    try{
      const origin=req.headers.origin;
      if(origin&&!origins.has(origin))throw new ApiError(403,'ORIGIN_DENIED','Origin is not allowed.');
      if(origin)res.setHeader('Access-Control-Allow-Origin',origin);
      if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Methods':'GET,POST,DELETE,OPTIONS','Access-Control-Allow-Headers':'Authorization,Content-Type','Access-Control-Max-Age':'600'});res.end();return;}
      const url=new URL(req.url,'http://service.local');
      if(req.method==='GET'&&url.pathname==='/health'){json(200,{status:'ok',apiVersion:1,storage:'memory'});return;}
      // A reverse proxy can put every player behind the same peer address.
      // Use verified membership or ticket IDs when possible; never trust a
      // caller-supplied forwarding header or allocate buckets for bogus tokens.
      const ip=req.socket.remoteAddress||'unknown';
      const token=(req.headers.authorization||'').match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
      const body=async()=>{
        if(!((req.headers['content-type']||'').split(';')[0].trim().toLowerCase()==='application/json'))throw new ApiError(415,'JSON_REQUIRED','Use application/json.');
        const chunks=[];let size=0;
        for await(const chunk of req.iterator({destroyOnReturn:false})){size+=chunk.length;if(size>2048){req.resume();throw new ApiError(413,'BODY_TOO_LARGE','Request body exceeds 2 KiB.');}chunks.push(chunk);}
        const text=Buffer.concat(chunks).toString('utf8');
        let data;try{data=JSON.parse(text);}catch{throw new ApiError(400,'INVALID_JSON','Invalid JSON body.');}
        if(!data||typeof data!=='object'||Array.isArray(data))throw new ApiError(400,'INVALID_BODY','Expected an object.');return data;
      };
      const name=data=>{const value=data.name===undefined?'Player':data.name;if(typeof value!=='string'||!value.trim()||value.trim().length>24||/[\u0000-\u001f\u007f]/.test(value))throw new ApiError(400,'INVALID_NAME','Name must be 1–24 characters without control characters.');return value.trim();};
      if(req.method==='POST'&&url.pathname==='/api/v1/matchmaking'){
        limit('enroll:'+ip,matchmakingRateLimit,res);const data=await body();json(201,matchmakingStore.find(name(data),data.mode));return;
      }
      const ticketRoute=url.pathname.match(/^\/api\/v1\/matchmaking\/([a-f0-9]{24})$/);
      if(ticketRoute){
        const id=ticketRoute[1];authenticate(token,()=>matchmakingStore.authorize(id,token),ip,res,'A matchmaking ticket token is required.');
        limit('ticket:'+id,rateLimit,res);
        if(req.method==='GET'){json(200,matchmakingStore.status(id,token));return;}
        if(req.method==='DELETE'){json(200,matchmakingStore.cancel(id,token));return;}
        throw new ApiError(405,'METHOD_NOT_ALLOWED','Method not allowed.');
      }
      if(req.method==='POST'&&url.pathname==='/api/v1/rooms'){
        limit('lobby:'+ip,rateLimit,res);const data=await body();json(201,store.create(name(data),{mode:data.mode}));return;
      }
      const route=url.pathname.match(/^\/api\/v1\/rooms\/([A-Z2-9]{6})(?:\/(join|ready|input|ping|battle(?:\/state)?))?$/);
      if(!route){limit('lobby:'+ip,rateLimit,res);throw new ApiError(404,'NOT_FOUND','Unknown endpoint.');}
      const[,code,action]=route;
      if(req.method==='POST'&&action==='join'){limit('lobby:'+ip,rateLimit,res);json(201,store.join(code,name(await body())));return;}
      const member=authenticate(token,()=>store.authorize(code,token),ip,res,'A room player token is required.');
      const bucket=action==='input'?'input':action==='ping'?'ping':'lobby';
      limit('member:'+member.entry.id+':'+bucket,bucket==='input'?inputRateLimit:bucket==='ping'?pingRateLimit:rateLimit,res);
      if(req.method==='GET'&&action==='battle'){startStream(code,token,req,res);return;}
      if(req.method==='GET'&&action==='battle/state'){json(200,store.battleSnapshot(member.room));return;}
      if(req.method==='POST'&&action==='input'){
        const result=store.input(code,token,await body()),room=store.rooms.get(code);json(200,result);
        if(result.ok||shouldSend(room,result.state.serverTime))sendState(code,result.state);return;
      }
      if(req.method==='GET'&&action==='ping'){json(200,store.issuePing(code,token));return;}
      if(req.method==='POST'&&action==='ping'){json(200,store.answerPing(code,token,(await body()).nonce));return;}
      if(req.method==='GET'&&!action){json(200,store.snapshot(member.room));return;}
      if(req.method==='DELETE'&&!action){json(200,leaveMember(code,token,member));return;}
      if(req.method==='POST'&&action==='ready'){const data=await body();if(typeof data.ready!=='boolean')throw new ApiError(400,'INVALID_READY','Ready must be a boolean.');json(200,store.ready(code,token,data.ready));return;}
      throw new ApiError(405,'METHOD_NOT_ALLOWED','Method not allowed.');
    }catch(error){
      if(error instanceof ApiError)json(error.status,{error:{code:error.code,message:error.message}});
      else{console.error('[backend] request failed');if(!res.headersSent)json(500,{error:{code:'INTERNAL_ERROR',message:'Internal server error.'}});else res.end();}
    }
  });
  server.requestTimeout=15000;server.headersTimeout=10000;server.maxHeadersCount=32;
  const timer=setInterval(()=>{matchmakingStore.prune();store.prune();const now=Date.now();for(const [key,bucket]of buckets)if(now>=bucket.resetAt)buckets.delete(key);},1000);timer.unref();server.once('close',()=>{clearInterval(timer);if(battleTimer)clearInterval(battleTimer);});
  return server;
}
if(require.main===module){
  const port=Number(process.env.PORT||8080);if(!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid PORT.');
  const server=createServer();server.listen(port,process.env.HOST||'0.0.0.0',()=>console.log(`Neon Parry backend listening on ${port}`));
  let stopping=false;for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{if(stopping)return;stopping=true;server.close(()=>process.exit(0));setTimeout(()=>{server.closeAllConnections();process.exit(1);},10000).unref();});
}
module.exports={createServer,parseOrigins};
