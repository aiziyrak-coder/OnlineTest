"""Text-only exam policy. Clinical imaging findings written in text remain valid."""
import re

TEXT_ONLY_INSTRUCTION = (
    "FAQAT MATNLI SAVOLLAR. Rasm, surat, diagramma, grafik, EKG tasviri yoki "
    "ilovaga qarashni talab qilma. Barcha klinik va tekshiruv topilmalari "
    "savolning o'zida so'zlar va sonlar bilan to'liq berilsin. "
    "No images, figures, photographs, charts or visual attachments. "
    "Describe all necessary findings in text; never refer to an unseen image.\n"
)
_VISUAL = re.compile(
    r'\b(?:rasm\w*|surat\w*|tasvir(?:da|ga)\w*|diagramma\w*|grafikda\w*|'
    r'расм\w*|сурат\w*|тасвирда\w*|рисун\w*|изображен\w*|фотограф\w*|снимк\w*|диаграмм\w*|'
    r'image\w*|figure\w*|diagram\w*|photograph\w*|pictured|shown\s+(?:above|below)|'
    r'(?:following|attached|shown|provided)\s+(?:(?:ct|mri)\s+)?(?:ecg|ekg|radiograph|scan|chart)|'
    r'(?:ecg|ekg|radiograph|scan)\s+(?:shown|below|above)|'
    r'(?:quyidagi|yuqoridagi|berilgan)\s+(?:ekg|rentgenogramma|tasvir)|'
    r'(?:рентгенограмм|томограмм|электрокардиограмм)\w*\s+(?:ниже|выше))\b',re.I)
_MEDIA_FIELDS={'image','image_url','imageUrl','images','picture','picture_url','diagram','media','attachment','attachments'}

def requires_visual(q):
    if not isinstance(q,dict): return True
    for key,value in q.items():
        if (key in _MEDIA_FIELDS or 'image' in key.lower() or key.lower().startswith('img')) and value: return True
        if key in ('text','stem','question','options') or key.startswith('text_') or key in ('translations','i18n'):
            if _content_visual(value): return True
    return False

def _content_visual(value):
    if isinstance(value,dict): return any(_content_visual(v) for v in value.values())
    if isinstance(value,list): return any(_content_visual(v) for v in value)
    text=str(value or '')
    return bool(_VISUAL.search(text) or re.search(r'<img\b|!\[[^\]]*\]\(|data:image/',text,re.I))

def text_only_pool(questions):
    return [q for q in (questions or []) if not requires_visual(q)]

def reusable_clinical(q):
    if requires_visual(q) or q.get('source')!='ai_generated': return False
    opts=q.get('options') or []
    lengths=[len(str(o).strip()) for o in opts]
    return (65<=len(str(q.get('text') or '').split())<=180 and len(opts)==5
            and len(set(opts))==5 and q.get('correctAnswer') in opts
            and min(lengths)>0 and max(lengths)/min(lengths)<=1.6)
