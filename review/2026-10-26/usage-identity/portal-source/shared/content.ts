import {z} from 'zod';
export function safeLink(value:string){try{const url=new URL(value);return ['http:','https:','mailto:'].includes(url.protocol)&&!/[\r\n]/.test(value);}catch{return false;}}
const inline=z.object({text:z.string().max(10000),bold:z.boolean().optional(),italic:z.boolean().optional(),href:z.string().max(2048).refine(safeLink,'Use an http, https, or mailto link.').optional()}).strict();
export const contentSchema=z.array(z.union([
 z.object({type:z.literal('paragraph'),children:z.array(inline).max(200)}).strict(),
 z.object({type:z.enum(['bulletList','orderedList']),items:z.array(z.array(inline).max(200)).min(1).max(100)}).strict()
])).min(1).max(100).refine(v=>JSON.stringify(v).length<=40000,'Content is too long.').refine(v=>v.some(b=>(b.type==='paragraph'?b.children:b.items.flat()).some(t=>t.text.trim())),'Write some content.');
export type Content=z.infer<typeof contentSchema>;
export const escapeHtml=(v:string)=>v.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function renderContent(input:unknown):string{
 const content=contentSchema.parse(input);
 const spans=(values:z.infer<typeof inline>[])=>values.map(v=>{let text=escapeHtml(v.text).replace(/\n/g,'<br>');if(v.bold)text=`<strong>${text}</strong>`;if(v.italic)text=`<em>${text}</em>`;if(v.href)text=`<a href="${escapeHtml(v.href)}" rel="noopener noreferrer">${text}</a>`;return text;}).join('');
 return content.map(b=>b.type==='paragraph'?`<p>${spans(b.children)}</p>`:`<${b.type==='bulletList'?'ul':'ol'}>${b.items.map(i=>`<li>${spans(i)}</li>`).join('')}</${b.type==='bulletList'?'ul':'ol'}>`).join('');
}
export function plainContent(input:unknown){return contentSchema.parse(input).map(b=>b.type==='paragraph'?b.children.map(t=>t.text+(t.href?` (${t.href})`:'')).join(''):b.items.map((i,n)=>(b.type==='bulletList'?'• ':`${n+1}. `)+i.map(t=>t.text+(t.href?` (${t.href})`:'')).join('')).join('\n')).join('\n\n');}
