import {runtime} from '../utils/runtime';
export default defineNitroPlugin(app=>{const timer=setInterval(()=>{try{void runtime().jobs.tick().catch(()=>console.error('Background work failed; inspect integration health.'));}catch{/* API reports missing configuration. */}},5000);timer.unref();app.hooks.hook('close',()=>clearInterval(timer));});
