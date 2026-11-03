'use strict';
// Optional lobby and server-authoritative duel transport. Loading never makes requests.
// Tokens stay with the caller; nothing is persisted or added to URLs.
(() => {
  class OnlineError extends Error {
    constructor(message,code,status=0){super(message);this.name='OnlineError';this.code=code;this.status=status;}
  }
  function createClient(baseUrl=window.NEON_CONFIG?.apiBaseUrl){
    if(!baseUrl)throw new OnlineError('Backend URL is not configured.','OFFLINE');
    let base;try{base=new URL(baseUrl);}catch{throw new OnlineError('Invalid backend URL.','INVALID_URL');}
    if(!['http:','https:'].includes(base.protocol)||base.username||base.password||base.search||base.hash)throw new OnlineError('Use an HTTP(S) backend URL without credentials or query.','INVALID_URL');
    const prefix=base.href.replace(/\/$/,'');
    let nextSeq=0;const matchIds=new Map();
    function rememberMatch(value){const room=value?.room||value;if(room?.code&&room.match?.id)matchIds.set(room.code,room.match.id);}
    async function request(path,{method='GET',data,token,keepalive=false}={}){
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
      try{
        const headers={};if(data!==undefined)headers['Content-Type']='application/json';if(token)headers.Authorization=`Bearer ${token}`;
        const response=await fetch(prefix+path,{method,headers,body:data===undefined?undefined:JSON.stringify(data),signal:controller.signal,credentials:'omit',cache:'no-store',redirect:'error',keepalive});
        let body;try{body=await response.json();}catch{throw new OnlineError('Invalid backend response.','INVALID_RESPONSE',response.status);}
        if(!response.ok)throw new OnlineError(body.error?.message||'Backend request failed.',body.error?.code||'HTTP_ERROR',response.status);
        rememberMatch(body);return body;
      }catch(error){
        if(error instanceof OnlineError)throw error;
        throw new OnlineError(controller.signal.aborted?'Backend request timed out.':'Backend is unreachable.',controller.signal.aborted?'TIMEOUT':'NETWORK_ERROR');
      }finally{clearTimeout(timer);}
    }
    function roomPath(code){if(typeof code!=='string'||!/^([A-Z2-9]){6}$/.test(code.toUpperCase()))throw new OnlineError('Invalid room code.','INVALID_ROOM_CODE');return'/api/v1/rooms/'+code.toUpperCase();}
    function ticketPath(id){if(typeof id!=='string'||!/^([a-f0-9]){24}$/.test(id))throw new OnlineError('Invalid matchmaking ticket.','INVALID_MATCH_TICKET');return'/api/v1/matchmaking/'+id;}
    function connectBattle(code,token,{onState=()=>{},onError=()=>{},onOpen=()=>{}}={}){
      const path=roomPath(code)+'/battle';let closed=false,controller=null,retryTimer=null,failures=0;
      function report(error){if(!closed)onError(error);}
      async function run(){
        controller=new AbortController();let reader;
        try{
          const response=await fetch(prefix+path,{headers:{Authorization:`Bearer ${token}`,Accept:'text/event-stream'},signal:controller.signal,credentials:'omit',cache:'no-store',redirect:'error'});
          if(!response.ok){let body;try{body=await response.json();}catch{}throw new OnlineError(body?.error?.message||'Battle connection failed.',body?.error?.code||'HTTP_ERROR',response.status);}
          if(!response.body?.getReader)throw new OnlineError('This browser does not support battle streaming.','STREAM_UNSUPPORTED');
          reader=response.body.getReader();const decoder=new TextDecoder();let buffer='';failures=0;onOpen();
          while(!closed){
            const{done,value}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true}).replace(/\r\n/g,'\n');
            if(buffer.length>262144)throw new OnlineError('Battle state exceeds the stream limit.','INVALID_RESPONSE');
            let split;
            while((split=buffer.indexOf('\n\n'))!==-1){
              const frame=buffer.slice(0,split);buffer=buffer.slice(split+2);let event='message';const lines=[];
              for(const line of frame.split('\n')){if(line.startsWith('event:'))event=line.slice(6).trim();else if(line.startsWith('data:'))lines.push(line.slice(5).trimStart());}
              if(event!=='state'||!lines.length)continue;
              let state;try{state=JSON.parse(lines.join('\n'));}catch{throw new OnlineError('Invalid battle state.','INVALID_RESPONSE');}
              if(!state.battle||!Number.isFinite(state.serverTime))throw new OnlineError('Invalid battle state.','INVALID_RESPONSE');
              rememberMatch(state);onState(state);
              if(state.battle.status==='finished'){closed=true;await reader.cancel();return;}
            }
          }
          if(!closed)throw new OnlineError('Battle connection was interrupted. Reconnecting…','STREAM_INTERRUPTED');
        }catch(error){
          if(closed)return;
          const failure=error instanceof OnlineError?error:new OnlineError('Battle connection was interrupted. Reconnecting…','NETWORK_ERROR');
          report(failure);
          if([400,401,403,404,409].includes(failure.status)||['INVALID_RESPONSE','STREAM_UNSUPPORTED'].includes(failure.code)){closed=true;return;}
          const delay=Math.min(3000,400*2**Math.min(failures++,3));retryTimer=setTimeout(run,delay);
        }finally{if(reader){try{await reader.cancel();}catch{}reader.releaseLock();}}
      }
      run();
      return Object.freeze({close(){closed=true;clearTimeout(retryTimer);controller?.abort();}});
    }
    return Object.freeze({
      health:()=>request('/health'),
      findMatch:(name='Player')=>request('/api/v1/matchmaking',{method:'POST',data:{name}}),
      getMatch:(id,token)=>request(ticketPath(id),{token}),
      cancelMatch:(id,token)=>request(ticketPath(id),{method:'DELETE',token,keepalive:true}),
      createRoom:(name='Player')=>request('/api/v1/rooms',{method:'POST',data:{name}}),
      joinRoom:(code,name='Player')=>request(roomPath(code)+'/join',{method:'POST',data:{name}}),
      getRoom:(code,token)=>request(roomPath(code),{token}),
      getBattle:(code,token)=>request(roomPath(code)+'/battle/state',{token}),
      connectBattle,
      sendInput:(code,token,input)=>{const seq=input.seq===undefined?nextSeq++:input.seq;nextSeq=Math.max(nextSeq,seq+1);return request(roomPath(code)+'/input',{method:'POST',data:{matchId:matchIds.get(code.toUpperCase()),...input,seq},token});},
      setReady:(code,token,ready)=>request(roomPath(code)+'/ready',{method:'POST',data:{ready},token}),
      leaveRoom:(code,token)=>request(roomPath(code),{method:'DELETE',token})
    });
  }
  window.NeonOnline=Object.freeze({createClient,OnlineError,isConfigured:()=>!!window.NEON_CONFIG?.apiBaseUrl});
})();
