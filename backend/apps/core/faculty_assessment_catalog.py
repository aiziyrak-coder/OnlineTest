"""Professor-o'qituvchilar bilimini baholash jadvali (DOCX manba).

Kafedra nomlari va fanlar ro'yxati shu faylda yagona manba sifatida saqlanadi.
"""
from __future__ import annotations

import re
import unicodedata

# DOCX: professor-o'qituvchilarini bilimini baxolash — kafedra → sana → fanlar
ASSESSMENT: list[dict] = [
    {
        "doc_name": "Kommunal va mehnat gigiyenasi kafedrasi",
        "date": "2026-09-04",
        "prefer_names": ["Kommunal va mehnat gigienasi"],
        "aliases": [
            "kommunal va mehnat gigiyenasi",
            "kommunal va mehnat gigienasi",
        ],
        "subjects": [
            "Gigiyena, harbiy gigiyena. Tibbiy ekologiya",
            "Gigiena. Tibbiy ekologiya",
        ],
    },
    {
        "doc_name": "Ovqatlanish, bolalar va o‘smirlar gigienasi kafedrasi",
        "date": "2026-09-04",
        "prefer_names": ["Ovqatlanish,  bolalar va o'smirlar gigiyenasi"],
        "aliases": [
            "ovqatlanish, bolalar va o'smirlar gigiyenasi",
            "ovqatlanish, bolalar va o'smirlar gigienasi",
        ],
        "subjects": [
            "Bolalar va o'smirlar gigiyenasi",
            "Ovqatlanish gigienasi",
        ],
    },
    {
        "doc_name": "Preventiv tibbiyot asoslari, jamoat salomatligi, jismoniy tarbiya va sport kafedrasi",
        "date": "2026-09-04",
        "aliases": [
            "preventiv tibbiyot asoslari, jamoat salomatligi, jismoniy tarbiya va sport",
            "preventive tibbiyot, jamoat salomatligi, jismoniy tarbiya va sport",
        ],
        "subjects": [
            "Jamoat salomatligi. Marketing, menejment",
        ],
    },
    {
        "doc_name": "Epidemiologiya va yuqumli kasalliklar, hamshiralik ishi kafedrasi",
        "date": "2026-09-04",
        "prefer_names": ["Epidemiyologiya va yuqumli kasalliklar, hamshiralik ishi"],
        "aliases": [
            "epidemiologiya va yuqumli kasalliklar, hamshiralik ishi",
            "epidemiyologiya va yuqumli kasalliklar, hamshiralik ishi",
        ],
        "subjects": [
            "Yuqumli kasalliklar",
            "Epidemiologiya",
            "Hamshiralik ishi",
        ],
    },
    {
        "doc_name": "Mikrobiologiya, virusologiya va immunologiya kafedrasi",
        "date": "2026-09-04",
        "aliases": [
            "mikrobiologiya, virusologiya va immunologiya",
            "mikrobiologiya, virusalogiya va immunologiya",
        ],
        "subjects": [
            "Mikrobiologiya, Virusologiya va immunologiya",
            "Klinik immunologiya",
        ],
    },
    {
        "doc_name": "Xalq tabobati va farmakologiya kafedrasi",
        "date": "2026-09-04",
        "aliases": [
            "xalq tabobati va farmakologiya kafedrasi",
            "xalq tabobati va farmakologiya",
        ],
        "subjects": ["Farmakologiya"],
    },
    {
        "doc_name": "Ichki kasalliklar propedevtikasi kafedrasi",
        "date": "2026-09-04",
        "aliases": [
            "ichki kasalliklar propedevtikasi",
            "ichki kasallilar propedevtikasi",
            "ichki kasallalliklar propedevtikasi",
        ],
        "subjects": ["Ichki kasalliklar propedevtikasi"],
    },
    {
        "doc_name": "Terapiya yo‘nalishidagi fanlar (UASH) kafedrasi",
        "date": "2026-09-04",
        "aliases": [
            "terapiya yo'nalishidagi fanlar (uash)",
            "terapiya yo'nalishidagi fanlar",
        ],
        "subjects": ["Ichki kasalliklar"],
    },
    {
        "doc_name": "Travmatologiya va ortopediya kafedrasi",
        "date": "2026-09-04",
        "aliases": [
            "travmatologiya va ortopediya",
            "travmatologiya va ortapediya",
        ],
        "subjects": [
            "Travmatologiya va ortopediya. Bolalar travmatologiyasi va ortopediyasi",
            "Neyroxirurgiya",
            "Harbiy dala jarrohligi",
        ],
    },
    {
        "doc_name": "Yu.Nishanov nomidagi Normal anatomiya kafedrasi",
        "date": "2026-09-04",
        "aliases": [
            "normal anatomiya",
            "yu.nishanov nomidagi normal anatomiya",
        ],
        "subjects": [
            "Odam anatomiyasi",
            "Klinik anatomiya (Operativ jarrohlik va topografik anatomiya)",
        ],
    },
    {
        "doc_name": "Gospital terapiya (laboratoriya) kafedrasi",
        "date": "2026-09-04",
        "aliases": [
            "gospital terapiya (laboratoriya)",
            "gospital terapiya",
        ],
        "subjects": [
            "Ichki kasalliklar. Klinik allergologiya, immunologiya. Kasb kasalliklari",
            "Klinik laboratoriya tashxisi. Immunferment tahlili",
        ],
    },
    {
        "doc_name": "Umumiy jarrohlik kafedrasi",
        "date": "2026-09-04",
        "aliases": [
            "umumiy jarrohlik",
            "umumiy xirurgiya",
        ],
        "subjects": [
            "Umumiy xirurgiya",
            "Bolalar xirurgiyasi",
            "Oftalmologiya",
            "Urologiya, bolalar urologiyasi",
        ],
    },
    {
        "doc_name": "Fakultet va gospital jarrohlik kafedrasi",
        "date": "2026-09-04",
        "prefer_names": ["Fakultet va gospital jarrohlik"],
        "aliases": [
            "fakultet va gospital jarrohlik",
        ],
        "subjects": ["Xirurgik kasalliklar"],
    },
    {
        "doc_name": "Akusherlik va ginekologiya kafedrasi",
        "date": "2026-09-05",
        "aliases": ["akusherlik va ginekologiya"],
        "subjects": ["Akusherlik va ginekologiya"],
    },
    {
        "doc_name": "Urologiya va onkologiya kafedrasi",
        "date": "2026-09-05",
        "aliases": [
            "urologiya va onkologiya",
        ],
        "subjects": ["Urologiya", "Onkologiya"],
    },
    {
        "doc_name": "Nevrologiya va psixiatriya",
        "date": "2026-09-05",
        "aliases": [
            "nevrologiya va psixiatriya",
        ],
        "subjects": [
            "Nevrologiya",
            "Psixiatriya, narkologiya",
            "Tibbiy psixologiya",
        ],
    },
    {
        "doc_name": "Pediatriya kafedrasi",
        "date": "2026-09-05",
        "aliases": [
            "pediatriya 1",
            "pediatriya kafedrasi",
        ],
        "subjects": [
            "Bolalar kasalliklari propedevtikasi",
            "Pediatriya",
        ],
    },
    {
        "doc_name": "Pediatriya 2 kafedrasi",
        "date": "2026-09-05",
        "aliases": [
            "pediatriya 2",
            "pediatriya-2",
            "pediatriya2",
        ],
        "subjects": [
            "Anesteziologiya, reanimatologiya",
            "Tez tibbiy yordam",
            "Bolalar kasalliklari propedevtikasi",
            "Pediatriya",
        ],
    },
    {
        "doc_name": "Stomatologiya va otoloringologiya kafedrasi",
        "date": "2026-09-05",
        "aliases": [
            "stomatologiya va otoloringologiya",
            "stomatologiya va otorinoloringologiya",
        ],
        "subjects": [
            "Otorinolaringologiya",
            "Xirurgik stomatologiya",
            "Yuz-jag' kasalliklari va jarohatlari",
            "Parodontologiya",
            "Otorinolaringologiya. Stomatologiya",
        ],
    },
    {
        "doc_name": "Dermatovenerologiya va allergologiya kafedrasi",
        "date": "2026-09-05",
        "aliases": ["dermatovenerologiya va allergologiya"],
        "subjects": [
            "Dermatovenerologiya",
            "Klinik allergologiya, immunologiya",
        ],
    },
    {
        "doc_name": "Endokrinologiya, gemotologiya va ftiziatriya kafedrasi",
        "date": "2026-09-05",
        "aliases": [
            "endokrinologiya, gematologiya va ftiziatriya kafedrasi",
            "endokrinologiya gematologiya va ftizatriya",
            "endokrinologiya, gemotologiya va ftiziatriya",
        ],
        "subjects": [
            "Tibbiy radiologiya",
            "Endokrinologiya",
            "Ftiziatriya, bolalar ftiziatriyasi",
            "Gematologiya",
        ],
    },
    {
        "doc_name": "Tibbiy va biologik kimyo kafedrasi",
        "date": "2026-09-05",
        "aliases": ["tibbiy va biologik kimyo"],
        "subjects": ["Tibbiy kimyo", "Biokimyo"],
    },
    {
        "doc_name": "Gistologiya va biologiya kafedrasi",
        "date": "2026-09-05",
        "aliases": [
            "gistologiya va biologiya",
            "gistologiya biologiya",
        ],
        "subjects": [
            "Tibbiy biologiya. Umumiy genetika",
            "Gistologiya, sitologiya, embriologiya",
        ],
    },
    {
        "doc_name": "Fiziologiya kafedrasi",
        "date": "2026-09-05",
        "aliases": ["fiziologiya"],
        "subjects": ["Normal fiziologiya"],
    },
    {
        "doc_name": "Patologik fiziologiya va patologik anatomiya kafedrasi",
        "date": "2026-09-05",
        "aliases": ["patologik fiziologiya va patologik anatomiya"],
        "subjects": [
            "Patologik anatomiya",
            "Patologik fiziologiya",
            "Sud tibbiyoti va vrach faoliyatining huquqiy asoslari",
        ],
    },
]


def norm_kafedra_name(s: str) -> str:
    s = unicodedata.normalize("NFKC", str(s or "")).lower().strip()
    s = s.replace("ʻ", "'").replace("ʼ", "'").replace("'", "'").replace("`", "'")
    s = s.replace("ё", "е")
    s = re.sub(r"\bkafedrasi\b", "", s)
    s = re.sub(r"[^\w\s]+", " ", s, flags=re.UNICODE)
    s = re.sub(r"\s+", " ", s).strip()
    return s
