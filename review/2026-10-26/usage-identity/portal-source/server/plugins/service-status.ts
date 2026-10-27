import {runtime} from '../utils/runtime';
export default defineNitroPlugin(app=>{
  const tick=()=>{try{void runtime().serviceStatus.check().catch(()=>console.error('Service monitoring could not complete.'));}catch{/* APIs report missing application configuration. */}};
  tick();
  const timer=setInterval(tick,5000);timer.unref();
  app.hooks.hook('close',()=>clearInterval(timer));
});
