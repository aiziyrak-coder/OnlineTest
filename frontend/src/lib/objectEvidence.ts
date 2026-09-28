export type ObjectDetection = {
  categories?: Array<{categoryName?: string; score?: number}>;
  boundingBox?: {originX: number; originY: number; width: number; height: number};
};
export const OBJECT_SCORE = 0.8;
export function visibleObject(d: ObjectDetection, width: number, height: number) {
  const cat = [...(d.categories || [])].sort((a,b)=>(b.score || 0)-(a.score || 0))[0];
  if (!cat || !Number.isFinite(cat.score) || Number(cat.score) < OBJECT_SCORE) return null;
  const label=String(cat.categoryName || '').toLowerCase().replace(/[_-]+/g,' ');
  const kind = ({'cell phone':'FORBIDDEN_OBJECT_CELL_PHONE', 'phone':'FORBIDDEN_OBJECT_CELL_PHONE',
    'cellphone':'FORBIDDEN_OBJECT_CELL_PHONE', 'book':'FORBIDDEN_OBJECT_BOOK',
    'laptop':'FORBIDDEN_OBJECT_LAPTOP'} as Record<string,string>)[label];
  const b=d.boundingBox;
  if (!kind || !b || width<=0 || height<=0) return null;
  if (![b.originX,b.originY,b.width,b.height].every(Number.isFinite) || b.width<=0 || b.height<=0) return null;
  const area=b.width*b.height/(width*height), ratio=b.width/b.height;
  if (area<.001 || area>.6 || ratio<.15 || ratio>6 || b.originX<0 || b.originY<0 ||
      b.originX+b.width>width*1.02 || b.originY+b.height>height*1.02) return null;
  return {violationType:kind,label,score:Number(cat.score),box:b};
}
