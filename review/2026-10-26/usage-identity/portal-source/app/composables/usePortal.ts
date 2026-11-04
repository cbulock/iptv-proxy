export function usePortal(){
  const state=useState<any>('portal',()=>null);
  const requestFetch=useRequestFetch();
  const refresh=async()=>{state.value=await requestFetch('/api/me');return state.value;};
  const send=async(path:string,body:any={})=>$fetch<any>('/api/'+path,{method:'POST',headers:{'x-bulock-request':'1'},body});
  return {state,refresh,send};
}
export function errorText(e:any){return e?.data?.message||e?.message||'Something went wrong. Please try again.';}
