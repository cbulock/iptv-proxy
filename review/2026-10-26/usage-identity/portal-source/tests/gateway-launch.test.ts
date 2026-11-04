import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {createGateway} from '../integrations/iptv/gateway.mjs';

for(const outcome of ['success','expired','network','missing'] as const){
  test(`browser launch completes without a second click: ${outcome}`,async()=>{
    const gateway=createGateway({publicUrl:'http://127.0.0.1',portal:'http://portal',internalKey:'test-key'});
    await new Promise<void>(resolve=>gateway.listen(0,'127.0.0.1',resolve));
    try{
      const base=`http://127.0.0.1:${(gateway.address() as any).port}`;
      const html=await (await fetch(base+'/portal-launch')).text();
      const script=html.match(/<script>([\s\S]*?)<\/script>/)![1];
      const elements:Record<string,any>={status:{textContent:''},open:{disabled:false}};
      const events:string[]=[];
      let requests=0;
      await runInNewContext(script,{
        URLSearchParams,
        location:{hash:outcome==='missing'?'':'#code=one-time-code',replace:(path:string)=>events.push('navigate:'+path)},
        history:{replaceState:(_state:any,_title:string,path:string)=>events.push('clean:'+path)},
        document:{getElementById:(id:string)=>elements[id]},
        fetch:async(path:string,options:RequestInit)=>{
          requests++;
          assert.deepEqual(events,['clean:/portal-launch'],'remove the code before exchanging it');
          assert.equal(path,'/portal-launch');
          assert.equal(options.method,'POST');
          assert.equal((options.headers as Record<string,string>)['X-Bulock-Request'],'1');
          assert.equal((options.headers as Record<string,string>)['Content-Type'],'application/json');
          assert.deepEqual(JSON.parse(options.body as string),{code:'one-time-code'});
          if(outcome==='network')throw Error('Offline');
          return {ok:outcome==='success'};
        }
      });
      assert.equal(requests,outcome==='missing'?0:1,'exchange automatically, exactly once, only with a code');
      if(outcome==='success')assert.deepEqual(events,['clean:/portal-launch','navigate:/']);
      else{
        assert.deepEqual(events,['clean:/portal-launch'],'never open the player after a failed launch');
        assert.match(elements.status.textContent,/Open Live TV from the portal again/);
      }
    }finally{gateway.closeAllConnections();await new Promise<void>(resolve=>gateway.close(()=>resolve()));}
  });
}
