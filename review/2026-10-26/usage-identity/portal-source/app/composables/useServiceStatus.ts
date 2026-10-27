import {freshMeasurement,measurementTime,serviceIds} from '#shared/service-status';
import type {ServiceMeasurement,StatusSnapshot} from '#shared/service-status';

export function useServiceStatus(poll=false){
  const {state:portal}=usePortal(),request=useRequestFetch(),route=useRoute();
  const data=useState<StatusSnapshot|null>('service-status',()=>null);
  const receivedAt=useState('service-status-received',()=>Date.now()),now=useState('service-status-now',()=>Date.now());
  const failed=useState('service-status-failed',()=>false);
  const services=computed(()=>{
    const measured=data.value?.services??serviceIds.map(id=>({id,state:'unknown',checkedAt:null,lastSuccess:null,outageSince:null,recoveredAt:null} as ServiceMeasurement));
    const serverNow=measurementTime(data.value?.serverTime??now.value,receivedAt.value,now.value);
    return measured.map(row=>freshMeasurement(row,serverNow));
  });
  let inFlight=false;
  async function refresh(){
    if(inFlight||!portal.value?.user||route.path==='/preview')return;inFlight=true;const userId=portal.value.user.id;
    try{const result=await request<StatusSnapshot>('/api/status');if(portal.value?.user?.id===userId){data.value=result;receivedAt.value=now.value=Date.now();failed.value=false;}}
    catch{if(portal.value?.user?.id===userId)failed.value=true;}finally{inFlight=false;}
  }
  if(poll){
    let timer:ReturnType<typeof setInterval>|undefined,lastAttempt=0;
    const visible=()=>{now.value=Date.now();if(document.visibilityState==='visible'&&portal.value?.user&&route.path!=='/preview'&&now.value-lastAttempt>=30000){lastAttempt=now.value;void refresh();}};
    const visibility=()=>{if(document.visibilityState==='visible'){lastAttempt=0;visible();}};
    onMounted(()=>{visible();timer=setInterval(visible,10000);document.addEventListener('visibilitychange',visibility);});
    watch(()=>portal.value?.user?.id,()=>{data.value=null;failed.value=false;lastAttempt=0;if(import.meta.client)visible();});
    onBeforeUnmount(()=>{clearInterval(timer);if(import.meta.client)document.removeEventListener('visibilitychange',visibility);});
  }
  return {data,services,failed,refresh};
}
