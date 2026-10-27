import {Fault} from './crypto.ts';
import {XMLParser} from 'fast-xml-parser';
const parser=new XMLParser({ignoreAttributes:false,attributeNamePrefix:'',parseAttributeValue:false,isArray:(name:string)=>['SharedServer','Section','User','Server'].includes(name)});
export function parseRemote(text:string){if(text.trim().startsWith('<'))return parser.parse(text);return JSON.parse(text);}
export async function remote(url:string,options:RequestInit={}) {let response:Response;try{response=await fetch(url,{...options,signal:AbortSignal.timeout(12000),redirect:'error'});}catch{throw new Fault('The service is currently unreachable. Please try again.',503);}if(!response.ok)throw new Fault(`The service rejected the request (${response.status}).`,502);if(response.status===204)return null;const text=await response.text();if(!text)return null;try{return parseRemote(text);}catch{throw new Fault('Unexpected response from the service.',502);}}
