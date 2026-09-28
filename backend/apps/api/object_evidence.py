"""An object label or hand posture alone is not evidence of a physical device."""
import json
import math

OBJECT_TYPES={'FORBIDDEN_OBJECT_CELL_PHONE':'cell_phone',
              'FORBIDDEN_OBJECT_BOOK':'book', 'FORBIDDEN_OBJECT_LAPTOP':'laptop'}

def side_conversation_evidence(detail):
    try:
        d=json.loads(detail)
        return (d.get('policy')=='side_conversation_v1' and
                type(d.get('continuous_ms')) in (int,float) and 6000<=d['continuous_ms']<=120000)
    except (ValueError,TypeError,AttributeError):
        return False

def browser_object_evidence(detail):
    try:
        d=json.loads(detail)
        return (d.get('policy')=='visible_object_v2' and
                type(d.get('frames')) is int and d['frames']>=4 and
                type(d.get('continuous_ms')) in (int,float) and 1800<=d['continuous_ms']<=120000 and
                type(d.get('score')) in (int,float) and .8<=d['score']<=1)
    except (ValueError,TypeError,AttributeError):
        return False

def has_physical_evidence(result, kind):
    expected=OBJECT_TYPES.get(kind)
    if not expected or not result.get('ok'):
        return False
    for item in result.get('object_evidence') or []:
        if not isinstance(item,dict) or item.get('type')!=expected:
            continue
        score=item.get('confidence')
        bbox=item.get('bbox')
        if type(score) not in (int,float) or not .9<=score<=1:
            continue
        if not isinstance(bbox,list) or len(bbox)!=4 or not all(type(v) in (int,float) and math.isfinite(v) for v in bbox):
            continue
        x,y,w,h=bbox
        if x<0 or y<0 or w<=0 or h<=0 or x+w>1.02 or y+h>1.02 or w*h<.001:
            continue
        features=item.get('features')
        if not isinstance(features,list):
            continue
        features={f for f in features if isinstance(f,str)}
        required = ({'device_body'} <= features and bool(features & {'screen','camera_lenses'})) if expected=='cell_phone' else (
            {'bound_pages','printed_text'} <= features if expected=='book' else {'screen','keyboard'} <= features)
        if required and item.get('near_candidate') is True:
            return True
    return False
