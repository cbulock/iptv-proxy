<script setup lang="ts">
import {renderContent,safeLink,escapeHtml,type Content} from '#shared/content';
const props=defineProps<{modelValue:Content;disabled?:boolean}>();
const emit=defineEmits<{ 'update:modelValue':[value:Content] }>();
const editor=ref<HTMLElement>(),linkOpen=ref(false),link=ref(''),linkError=ref('');let savedRange:Range|null=null;
function sync(){if(!editor.value)return;try{editor.value.innerHTML=renderContent(props.modelValue);}catch{editor.value.innerHTML='<p><br></p>';}}
onMounted(sync);
type Span={text:string;bold?:boolean;italic?:boolean;href?:string};
function inlines(node:Node,marks:Omit<Span,'text'>={}):Span[]{
 if(node.nodeType===Node.TEXT_NODE)return [{text:node.textContent||'',...marks}];
 if(!(node instanceof HTMLElement))return [];
 if(['SCRIPT','STYLE','IMG','IFRAME','OBJECT'].includes(node.tagName))return [];
 if(node.tagName==='BR')return [{text:'\n',...marks}];
 const next={...marks};if(['B','STRONG'].includes(node.tagName))next.bold=true;if(['I','EM'].includes(node.tagName))next.italic=true;
 if(node.tagName==='A'&&safeLink(node.getAttribute('href')||''))next.href=node.getAttribute('href')!;
 return [...node.childNodes].flatMap(n=>inlines(n,next));
}
function changed(){if(!editor.value)return;const blocks:Content=[];let pending:Span[]=[];
 const flush=()=>{if(pending.length){blocks.push({type:'paragraph',children:pending});pending=[];}};
 function visit(node:Node){if(node instanceof HTMLElement&&['UL','OL'].includes(node.tagName)){flush();const items=[...node.children].filter(n=>n.tagName==='LI').map(n=>inlines(n));if(items.length)blocks.push({type:node.tagName==='UL'?'bulletList':'orderedList',items});}
 else if(node instanceof HTMLElement&&['DIV','P'].includes(node.tagName)){flush();for(const n of node.childNodes)visit(n);flush();}
 else pending.push(...inlines(node));}
 for(const node of editor.value.childNodes)visit(node);flush();emit('update:modelValue',blocks.length?blocks:[{type:'paragraph',children:[]}]);
}
function command(name:string,value?:string){editor.value?.focus();document.execCommand('styleWithCSS',false,'false');document.execCommand(name,false,value);changed();}
function showLink(){const selection=window.getSelection();if(selection?.rangeCount&&editor.value?.contains(selection.anchorNode)){savedRange=selection.getRangeAt(0).cloneRange();link.value='';linkError.value='';linkOpen.value=true;}else{editor.value?.focus();}}
function applyLink(){if(!safeLink(link.value)){linkError.value='Enter a complete http, https, or mailto link.';return;}editor.value?.focus();if(savedRange){const selection=window.getSelection();selection?.removeAllRanges();selection?.addRange(savedRange);}if(savedRange?.collapsed)document.execCommand('insertHTML',false,`<a href="${escapeHtml(link.value)}">${escapeHtml(link.value)}</a>`);else document.execCommand('createLink',false,link.value);changed();linkOpen.value=false;}
function paste(event:ClipboardEvent){event.preventDefault();command('insertText',event.clipboardData?.getData('text/plain')||'');}
</script>
<template><div class="content-editor"><div class="editor-toolbar" role="toolbar" aria-label="Text formatting">
 <CindorButton variant="ghost" type="button" :disabled="disabled" aria-label="Bold" @mousedown.prevent @click="command('bold')"><strong>B</strong></CindorButton>
 <CindorButton variant="ghost" type="button" :disabled="disabled" aria-label="Italic" @mousedown.prevent @click="command('italic')"><em>I</em></CindorButton>
 <CindorButton variant="ghost" type="button" :disabled="disabled" @mousedown.prevent @click="command('insertUnorderedList')">Bullets</CindorButton>
 <CindorButton variant="ghost" type="button" :disabled="disabled" @mousedown.prevent @click="command('insertOrderedList')">Numbered list</CindorButton>
 <CindorButton variant="ghost" type="button" :disabled="disabled" @mousedown.prevent @click="showLink">Link</CindorButton>
 <CindorButton variant="ghost" type="button" :disabled="disabled" @mousedown.prevent @click="command('unlink')">Remove link</CindorButton>
 </div><div v-if="linkOpen" class="editor-link"><label>Link URL<input v-model="link" type="url" placeholder="https://…" @keydown.enter.prevent="applyLink"></label><CindorButton variant="ghost" type="button" class="button" @click="applyLink">Apply link</CindorButton><CindorButton variant="ghost" type="button" class="text-button" @click="linkOpen=false">Cancel</CindorButton><p v-if="linkError" role="alert">{{linkError}}</p></div>
 <div ref="editor" class="editor-body formatted-content" :contenteditable="!disabled" role="textbox" aria-label="Message body" aria-multiline="true" @input="changed" @paste="paste" @drop.prevent/>
 </div></template>
