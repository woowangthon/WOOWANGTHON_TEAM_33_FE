// A second click on the same item shares its request. A new selection or
// navigation cancels the previous request and prevents late results winning.
export function createLatestRequest<T>(fetcher:(id:string,signal:AbortSignal)=>Promise<T>) {
  let current:{id:string;controller:AbortController;promise:Promise<void>}|undefined;
  function cancel(){const previous=current;current=undefined;previous?.controller.abort();}
  function open(id:string,callbacks:{pending:()=>void;success:(value:T)=>void;error:(error:unknown)=>void;settled:()=>void}) {
    if(current?.id===id)return current.promise;
    cancel();
    const request={id,controller:new AbortController(),promise:Promise.resolve()};
    current=request;
    callbacks.pending();
    request.promise=(async()=>{
      try {const value=await fetcher(id,request.controller.signal);if(current===request)callbacks.success(value);}
      catch(error){if(current===request)callbacks.error(error);}
      finally{if(current===request){current=undefined;callbacks.settled();}}
    })();
    return request.promise;
  }
  return {open,cancel};
}
