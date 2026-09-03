export type ClinicalExportPatient={full_name:string;email?:string;phone?:string;birth_date?:string;cpf?:string}
export type ClinicalExportNote={session_date:string;note_text:string;created_at?:string}

const enc=new TextEncoder()
const safeName=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[<>:"/\\|?*\x00-\x1F]/g,'_').trim().replace(/\s+/g,'_').slice(0,90)||'Paciente'
export const patientFolderName=(name:string)=>safeName(name)
export const sessionFolderName=(date:string)=>`sessao_${formatDateFile(date)}`
export const formatDateFile=(date:string)=>{const [y,m,d]=String(date||'').slice(0,10).split('-');return y&&m&&d?`${d}-${m}-${y}`:safeName(date||'sem-data')}
export const formatDateBr=(date:string)=>{const [y,m,d]=String(date||'').slice(0,10).split('-');return y&&m&&d?`${d}/${m}/${y}`:String(date||'')}

function clinicalLines(patient:ClinicalExportPatient,note:ClinicalExportNote){return [
  'PsicoGestão - Prontuário clínico',
  '',
  `Paciente: ${patient.full_name}`,
  patient.email?`E-mail: ${patient.email}`:'',
  patient.phone?`Telefone: ${patient.phone}`:'',
  patient.birth_date?`Nascimento: ${formatDateBr(patient.birth_date)}`:'',
  patient.cpf?`CPF: ${patient.cpf}`:'',
  '',
  `Data da sessão: ${formatDateBr(note.session_date)}`,
  '',
  'Observações clínicas:',
  note.note_text||'',
  '',
  note.created_at?`Registro criado em: ${new Date(note.created_at).toLocaleString('pt-BR')}`:'',
].filter((line,index,arr)=>line!==''||arr[index-1]!=='' )}

function rtfEscape(value:string){let out='';for(const ch of value){const code=ch.codePointAt(0)||0;if(ch==='\\'||ch==='{'||ch==='}')out+='\\'+ch;else if(code===10)out+='\\par\n';else if(code>=32&&code<127)out+=ch;else{const signed=code>32767?code-65536:code;out+=`\\u${signed}?`}}return out}
export function clinicalRtf(patient:ClinicalExportPatient,note:ClinicalExportNote){
  const lines=clinicalLines(patient,note)
  const body=lines.map((line,i)=>`${i===0?'\\b\\fs28 ':'\\b0\\fs22 '}${rtfEscape(line)}\\par`).join('\n')
  return `{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Aptos;}}\\viewkind4\\uc1\\pard\\f0 ${body}}`
}

function downloadBlob(blob:Blob,filename:string){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1200)}
export function downloadWord(patient:ClinicalExportPatient,note:ClinicalExportNote){downloadBlob(new Blob([clinicalRtf(patient,note)],{type:'application/rtf'}),`anamnese_${formatDateFile(note.session_date)}_${safeName(patient.full_name)}.rtf`)}

function latin1Bytes(value:string){const out:number[]=[];for(const ch of value){const cp=ch.codePointAt(0)||32;out.push(cp<=255?cp:63)}return new Uint8Array(out)}
function pdfEsc(value:string){return value.replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)').replace(/[\r\n]+/g,' ')}
function wrap(text:string,width=92){const src=String(text||'').split(/\r?\n/),out:string[]=[];for(const paragraph of src){if(!paragraph){out.push('');continue}const words=paragraph.split(/\s+/);let line='';for(const word of words){if(!line){line=word;continue}if((line+' '+word).length<=width)line+=' '+word;else{out.push(line);line=word}}if(line)out.push(line)}return out}
function concat(parts:Uint8Array[]){const total=parts.reduce((n,p)=>n+p.length,0),out=new Uint8Array(total);let o=0;for(const p of parts){out.set(p,o);o+=p.length}return out}
function ascii(value:string){return enc.encode(value)}
export function clinicalPdfBytes(patient:ClinicalExportPatient,note:ClinicalExportNote){
  const lines=clinicalLines(patient,note).flatMap(line=>wrap(line)),perPage=48,pages=Array.from({length:Math.max(1,Math.ceil(lines.length/perPage))},(_,i)=>lines.slice(i*perPage,(i+1)*perPage))
  const fontId=3+pages.length*2,objects:Uint8Array[]=[]
  objects[1]=ascii('<< /Type /Catalog /Pages 2 0 R >>')
  const kids=pages.map((_,i)=>`${3+i*2} 0 R`).join(' ');objects[2]=ascii(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`)
  pages.forEach((pageLines,i)=>{
    const pageId=3+i*2,contentId=pageId+1
    objects[pageId]=ascii(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`)
    const contentParts=[ascii('BT\n/F1 11 Tf\n50 790 Td\n14 TL\n')]
    pageLines.forEach(line=>{contentParts.push(ascii('('));contentParts.push(latin1Bytes(pdfEsc(line)));contentParts.push(ascii(') Tj\nT*\n'))});contentParts.push(ascii('ET'))
    const stream=concat(contentParts);objects[contentId]=concat([ascii(`<< /Length ${stream.length} >>\nstream\n`),stream,ascii('\nendstream')])
  })
  objects[fontId]=ascii('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
  const parts:Uint8Array[]=[ascii('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')],offsets:number[]=[0];let offset=parts[0].length
  for(let i=1;i<=fontId;i++){offsets[i]=offset;const obj=concat([ascii(`${i} 0 obj\n`),objects[i],ascii('\nendobj\n')]);parts.push(obj);offset+=obj.length}
  const xrefOffset=offset;let xref=`xref\n0 ${fontId+1}\n0000000000 65535 f \n`;for(let i=1;i<=fontId;i++)xref+=`${String(offsets[i]).padStart(10,'0')} 00000 n \n`;parts.push(ascii(xref+`trailer\n<< /Size ${fontId+1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`));return concat(parts)
}
export function downloadPdf(patient:ClinicalExportPatient,note:ClinicalExportNote){downloadBlob(new Blob([clinicalPdfBytes(patient,note)],{type:'application/pdf'}),`anamnese_${formatDateFile(note.session_date)}_${safeName(patient.full_name)}.pdf`)}

const crcTable=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=(c&1)?0xEDB88320^(c>>>1):c>>>1;t[n]=c>>>0}return t})()
function crc32(data:Uint8Array){let c=0xFFFFFFFF;for(const b of data)c=crcTable[(c^b)&255]^(c>>>8);return (c^0xFFFFFFFF)>>>0}
function le16(n:number){return new Uint8Array([n&255,(n>>>8)&255])}
function le32(n:number){return new Uint8Array([n&255,(n>>>8)&255,(n>>>16)&255,(n>>>24)&255])}
export function zipStore(files:{name:string;data:Uint8Array}[]){
  const locals:Uint8Array[]=[],centrals:Uint8Array[]=[];let offset=0
  for(const file of files){const name=enc.encode(file.name.replace(/\\/g,'/')),crc=crc32(file.data),size=file.data.length
    const local=concat([le32(0x04034b50),le16(20),le16(0x0800),le16(0),le16(0),le16(0),le32(crc),le32(size),le32(size),le16(name.length),le16(0),name,file.data]);locals.push(local)
    const central=concat([le32(0x02014b50),le16(20),le16(20),le16(0x0800),le16(0),le16(0),le16(0),le32(crc),le32(size),le32(size),le16(name.length),le16(0),le16(0),le16(0),le16(0),le32(0),le32(offset),name]);centrals.push(central);offset+=local.length}
  const centralBlob=concat(centrals),allLocal=concat(locals),end=concat([le32(0x06054b50),le16(0),le16(0),le16(files.length),le16(files.length),le32(centralBlob.length),le32(allLocal.length),le16(0)]);return concat([allLocal,centralBlob,end])
}
export function downloadBackupZip(files:{name:string;data:Uint8Array}[]){downloadBlob(new Blob([zipStore(files)],{type:'application/zip'}),`backup_prontuarios_${new Date().toISOString().slice(0,10)}.zip`)}
export const utf8=(value:string)=>enc.encode(value)
