"""
WebRTC signaling consumer — Node.js Socket.IO serverini almashtiradi.

Protocol:
  Client → Server  (JSON):
    { type: "join_exam",     exam_id: int, role: "student"|"proctor" }
    { type: "offer",         to: channel, offer: {}, from_id: channel }
    { type: "answer",        to: channel, answer: {} }
    { type: "ice_candidate", to: channel, candidate: {} }

  Server → Client  (JSON):
    { type: "connected",       channel: str }
    { type: "student_joined",  user_id: str, channel: str }
    { type: "offer",           from: channel, offer: {}, from_id: channel }
    { type: "answer",          from: channel, answer: {} }
    { type: "ice_candidate",   from: channel, candidate: {} }
"""
from __future__ import annotations

from urllib.parse import parse_qs

import jwt as pyjwt
from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from django.conf import settings

from apps.core.models.exam import Exam
from apps.api.permissions import EXAMINEE_ROLES


class ExamRealtimeConsumer(AsyncJsonWebsocketConsumer):

    async def connect(self) -> None:
        token = self._parse_token()
        user = self._verify_jwt(token)
        if user is None:
            await self.close(code=4001)
            return

        self.user_id: str = user["id"]
        self.role: str = user["role"]
        self.exam_id: int | None = None

        await self.accept()
        await self.send_json({"type": "connected", "channel": self.channel_name})

    async def disconnect(self, close_code: int) -> None:
        if self.exam_id is not None:
            await self.channel_layer.group_discard(
                f"exam_{self.exam_id}", self.channel_name
            )

    async def receive_json(self, content: dict, **kwargs) -> None:  # type: ignore[override]
        msg_type = content.get("type")
        if msg_type == "join_exam":
            await self._handle_join_exam(content)
        elif msg_type == "offer":
            await self._relay(content, "exam.webrtc_offer", {
                "offer": content.get("offer"),
                "from_id": content.get("from_id", self.channel_name),
            })
        elif msg_type == "answer":
            await self._relay(content, "exam.webrtc_answer", {
                "answer": content.get("answer"),
            })
        elif msg_type == "ice_candidate":
            await self._relay(content, "exam.webrtc_ice", {
                "candidate": content.get("candidate"),
            })

    # ── inbound helpers ────────────────────────────────────────────────────────

    def _parse_token(self) -> str:
        qs = parse_qs(self.scope["query_string"].decode("utf-8", errors="replace"))
        return qs.get("token", [""])[0]

    def _verify_jwt(self, token: str) -> dict | None:
        if not token:
            return None
        try:
            payload = pyjwt.decode(
                token,
                settings.JWT_SECRET,
                algorithms=["HS256"],
                options={"require": ["exp"]},
            )
            user_id = payload.get("id") or payload.get("sub")
            if not user_id:
                return None
            return {
                "id": str(user_id),
                "role": str(payload.get("role", "")).strip().lower(),
            }
        except pyjwt.PyJWTError:
            return None

    @database_sync_to_async
    def _proctor_may_join_exam(self, exam_id: int) -> bool:
        if self.role == "admin":
            return True
        if self.role == "staff":
            return Exam.objects.filter(pk=exam_id, teacher_id=self.user_id).exists()
        return False

    async def _handle_join_exam(self, content: dict) -> None:
        role = str(content.get("role", ""))
        # Imtihon topshiruvchi kanalga "student" bo'lib ulanadi -- klient
        # hamma uchun shu nomni yuboradi. Ilgari bu yerda faqat haqiqiy
        # role="student" o'tkazilardi: o'qituvchi, ordinator, magistr va
        # vakansiya nomzodi WebSocket ga umuman ulanolmasdi, ya'ni ular
        # uchun JONLI KUZATUV ishlamasdi (kuzatuvchi ekranida ular yo'q edi).
        if role == "student" and self.role not in EXAMINEE_ROLES:
            return
        if role == "proctor" and self.role not in ("admin", "staff"):
            return

        try:
            eid = int(content["exam_id"])
            assert 0 < eid < 2_147_483_648
        except (KeyError, TypeError, ValueError, AssertionError):
            return

        if role == "proctor" and not await self._proctor_may_join_exam(eid):
            return

        if self.exam_id is not None:
            await self.channel_layer.group_discard(f"exam_{self.exam_id}", self.channel_name)

        self.exam_id = eid
        await self.channel_layer.group_add(f"exam_{eid}", self.channel_name)

        if role == "student":
            await self.channel_layer.group_send(f"exam_{eid}", {
                "type": "exam.student_joined",
                "user_id": self.user_id,
                "student_channel": self.channel_name,
                "sender_channel": self.channel_name,
            })

    async def _relay(self, content: dict, msg_type: str, extra: dict) -> None:
        if self.exam_id is None:
            return
        to_channel = str(content.get("to", ""))
        if not to_channel:
            return
        await self.channel_layer.send(to_channel, {
            "type": msg_type,
            "from_channel": self.channel_name,
            "from_exam_id": self.exam_id,
            **extra,
        })

    # ── channel layer → client ─────────────────────────────────────────────────

    async def exam_student_joined(self, event: dict) -> None:
        if event["sender_channel"] == self.channel_name:
            return  # O'ziga yuborma
        await self.send_json({
            "type": "student_joined",
            "user_id": event["user_id"],
            "channel": event["student_channel"],
        })

    async def exam_webrtc_offer(self, event: dict) -> None:
        if event.get("from_exam_id") != self.exam_id:
            return  # Boshqa imtihondan signal kelib qolmasligi uchun
        await self.send_json({
            "type": "offer",
            "from": event["from_channel"],
            "offer": event["offer"],
            "from_id": event["from_id"],
        })

    async def exam_webrtc_answer(self, event: dict) -> None:
        if event.get("from_exam_id") != self.exam_id:
            return
        await self.send_json({
            "type": "answer",
            "from": event["from_channel"],
            "answer": event["answer"],
        })

    async def exam_webrtc_ice(self, event: dict) -> None:
        if event.get("from_exam_id") != self.exam_id:
            return
        await self.send_json({
            "type": "ice_candidate",
            "from": event["from_channel"],
            "candidate": event["candidate"],
        })

    async def exam_student_banned(self, event: dict) -> None:
        """Talaba ban bo'lganda barcha proktor/admin va talabaning o'ziga xabar."""
        if event.get("exam_id") != self.exam_id:
            return
        await self.send_json({
            "type": "student_banned",
            "student_id": event["student_id"],
            "student_name": event.get("student_name", ""),
            "student_exam_id": event.get("student_exam_id"),
            "exam_id": event["exam_id"],
            "reason": event.get("reason", ""),
            "violations_count": event.get("violations_count", 0),
        })

    async def exam_student_unblocked(self, event: dict) -> None:
        """Admin/staff unblock qilganda talabaga va proktorlarga xabar."""
        if event.get("exam_id") != self.exam_id:
            return
        await self.send_json({
            "type": "student_unblocked",
            "student_id": event["student_id"],
            "student_exam_id": event.get("student_exam_id"),
            "can_retake": event.get("can_retake", False),
        })

    async def exam_exam_retake(self, event: dict) -> None:
        if event.get("exam_id") != self.exam_id:
            return
        await self.send_json({
            "type": "exam_retake",
            "student_id": event["student_id"],
            "student_exam_id": event.get("student_exam_id"),
            "exam_id": event["exam_id"],
            "retakes_remaining": event.get("retakes_remaining", event.get("technical_retakes_remaining", 0)),
            "technical_retakes_remaining": event.get("technical_retakes_remaining", event.get("retakes_remaining", 0)),
            "retakes_used": event.get("retakes_used", 0),
            "reason": event.get("reason", ""),
            "identity_retake": event.get("identity_retake", False),
        })

    async def exam_technical_retake(self, event: dict) -> None:
        """Eski WS event — exam_retake ga yo'naltiriladi."""
        await self.exam_exam_retake(event)
