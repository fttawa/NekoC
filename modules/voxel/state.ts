// Small inline wrappers; all exported gameplay remains native Kitten N blocks.
export function v(name: string): number { return getVar(name) as number; }
export function item(name: string, i: number): number { return listItem(name,"any",i) as number; }
export function min(mna: number,mnb: number): number { return (mna+mnb-mathFunc("abs",mna-mnb))/2; }
export function max(mxa: number,mxb: number): number { return (mxa+mxb+mathFunc("abs",mxa-mxb))/2; }
export function clamp(clx: number,cla: number,clb: number): number { return min(clb,max(cla,clx)); }
export function cell(x: number,y: number,z: number): number { return 1+x+16*z+256*y; }
export function text(x: number,y: number,s: NekoValue,size: number): void { penUp();moveTo(x,y);stampText(s,size,"left"); }
