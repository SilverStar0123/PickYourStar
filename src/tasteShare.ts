import type { Character } from './similarTaste';
export function buildTasteShareUrl(ids: string[]): string {
 const q = new URLSearchParams();
 ids.slice(0, 2).forEach((id, i) => q.set(i ? 'b' : 'a', id));
 return `${window.location.origin}${window.location.pathname}#/taste?${q}`;
}
export function readTasteSelection(hash: string, catalog: readonly Character[]): Character[] {
 if (hash.split('?')[0] !== '#/taste') return [];
 const q = new URLSearchParams(hash.split('?')[1] || '');
 const a = catalog.find(c => c.id === q.get('a'));
 const b = catalog.find(c => c.id === q.get('b'));
 return a ? (b && b.id !== a.id ? [a,b] : [a]) : [];
}
export interface ShareCharacter { name: string; unit: string; img: string }
export interface TasteCard { title: string; chosenLabel: string; resultLabel: string; empty: string; chosen: ShareCharacter[]; recommendations: ShareCharacter[] }
const FONT = '"Noto Sans KR","Malgun Gothic","Apple SD Gothic Neo",sans-serif';
function loadPortrait(src: string): Promise<HTMLImageElement | null> {
 return new Promise(resolve => {
  const img = new Image(); img.crossOrigin = 'anonymous';
  const done = (value: HTMLImageElement | null) => { clearTimeout(timer); img.onload=null; img.onerror=null; resolve(value); };
  const timer = setTimeout(() => done(null), 5000);
  img.onload=()=>done(img.naturalWidth ? img : null); img.onerror=()=>done(null); img.src=src;
 });
}
export async function renderTasteCard(card: TasteCard): Promise<Blob> {
 const people = [...card.chosen, ...card.recommendations];
 const portraits = await Promise.all(people.map(p=>loadPortrait(p.img)));
 const canvas=document.createElement('canvas');canvas.width=1800;canvas.height=1500;
 const ctx=canvas.getContext('2d');if(!ctx)throw Error('Canvas unavailable');ctx.scale(1.5,1.5);
 const rounded=(x:number,y:number,w:number,h:number,r:number,color:string)=>{
  ctx.fillStyle=color;ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();ctx.fill();
 };
 const text=(s:string,x:number,y:number,size:number,color:string,width:number,weight=600)=>{
  ctx.font=`${weight} ${size}px ${FONT}`;ctx.fillStyle=color;ctx.textAlign='center';
  while(ctx.measureText(s).width>width&&size>14){size--;ctx.font=`${weight} ${size}px ${FONT}`;}
  ctx.fillText(s,x,y,width);
 };
 ctx.fillStyle='#fff2f6';ctx.fillRect(0,0,1200,1000);rounded(36,36,1128,928,32,'#fff');
 text('PICK YOUR STAR',600,93,19,'#a3657b',1000);
 text(card.title,600,150,42,'#263542',1040,800);
 text(card.chosenLabel,600,201,22,'#776675',1040);
 const person=(p:ShareCharacter,img:HTMLImageElement|null,x:number,y:number,size:number,width:number)=>{
  rounded(x-size/2,y,size,size,24,'#f4e3ea');
  if(img){ctx.save();ctx.clip();const side=Math.min(img.naturalWidth,img.naturalHeight);ctx.drawImage(img,(img.naturalWidth-side)/2,(img.naturalHeight-side)/2,side,side,x-size/2,y,size,size);ctx.restore();}
  else text(p.name.slice(0,2),x,y+size/2+12,32,'#a3657b',size-12);
  text(p.unit,x,y+size+30,18,'#77828d',width);
  text(p.name,x,y+size+65,27,'#263542',width,800);
 };
 card.chosen.forEach((p,i)=>person(p,portraits[i],600+(i-(card.chosen.length-1)/2)*380,228,120,340));
 ctx.strokeStyle='#eee3e8';ctx.beginPath();ctx.moveTo(90,454);ctx.lineTo(1110,454);ctx.stroke();
 text(card.resultLabel,600,514,30,'#954561',1020,800);
 card.recommendations.forEach((p,i)=>{
  const x=600+(i-(card.recommendations.length-1)/2)*344;
  rounded(x-160,552,320,302,24,'#fff7fa');
  person(p,portraits[card.chosen.length+i],x,579,164,284);
 });
 if(!card.recommendations.length)text(card.empty,600,689,27,'#77828d',980);
 text(`${window.location.host}${window.location.pathname}`,600,924,18,'#9a8991',1040);
 return new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('PNG failed')),'image/png'));
}
